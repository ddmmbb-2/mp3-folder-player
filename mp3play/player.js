// --- 核心變數 ---
let playlist = [];
let currentIndex = 0;
let playing = false;
let currentFolder = window.PLAYER_CONFIG.currentFolder; // 從 PHP 取得
let rawLyrics = "";

// 播放模式
let playModes = [
    { id: 'single', name: '單曲播放', icon: '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>' },
    { id: 'repeat-one', name: '單曲循環', icon: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="10" y="16" font-size="8" font-weight="bold">1</text>' },
    { id: 'repeat-all', name: '全部循環', icon: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
    { id: 'shuffle', name: '隨機播放', icon: '<polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line>' }
];
let currentModeIdx = 0;

// --- DOM 元素 ---
const audio = document.getElementById('audio');
const titleEl = document.getElementById('title');
const bar = document.getElementById('bar');
const progress = document.getElementById('progress');
const cur = document.getElementById('cur');
const dur = document.getElementById('dur');
const playBtn = document.getElementById('play');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const modeBtn = document.getElementById('modeBtn');
const modeStatus = document.getElementById('modeStatus');
const playlistEl = document.getElementById('playlist');
const lyricsText = document.getElementById('lyrics-text');
const folderSelect = document.getElementById('folderSelect');

// Modal Elements
const lyricsModal = document.getElementById('lyricsModal');
const modalTitle = document.getElementById('modalTitle');
const lyricsInput = document.getElementById('lyricsInput');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelLyricsBtn = document.getElementById('cancelLyricsBtn');
const saveLyricsBtn = document.getElementById('saveLyricsBtn');

// 音效 Elements
const pitchSlider = document.getElementById('pitchSlider');
const pitchDisplay = document.getElementById('pitchDisplay');
const vocalToggle = document.getElementById('vocalToggle');

const fmt = t => isNaN(t) ? '0:00' : Math.floor(t/60) + ':' + ('0' + Math.floor(t%60)).slice(-2);
const icons = {
    play: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
};
playBtn.innerHTML = icons.play;

// ==========================================
// Web Audio API & 音效處理區塊
// ==========================================
let audioCtx;
let sourceNode;
let pitchNode; 
let vocalRemoverInput, vocalRemoverOutput;
let isVocalRemovalActive = false;

// 新增變數：記憶當前的設定值 (解決還沒按播放前拉滑桿會失效的問題)
let currentPitchFactor = 1.0;
let currentSemitones = 0;

async function initAudioFX() {
    if (audioCtx) return; 
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    sourceNode = audioCtx.createMediaElementSource(audio);

    // 1. 去人聲管線 (相位抵消 + 低頻保留)
    setupVocalRemover();

    // 2. 準備 SoundTouch Worklet 
    try {
        await audioCtx.audioWorklet.addModule('./soundtouch-processor.js');
        pitchNode = new AudioWorkletNode(audioCtx, 'soundtouch-processor');
        
        // 監聽 Worklet 內部是否有崩潰報錯
        pitchNode.onprocessorerror = (err) => {
            console.error("升降 Key 處理器內部發生錯誤：", err);
        };
        
        // 節點一建立好，立刻套用目前的滑桿數值
        applyPitchSettings();

        // 【Debug 用】印出處理器真正開放的參數名稱，確認有沒有載入成功
        if (pitchNode.parameters) {
            let params = [];
            pitchNode.parameters.forEach((v, key) => params.push(key));
            console.log("🎵 SoundTouch 載入成功！處理器開放的參數有：", params.join(', '));
        }

    } catch (e) {
        console.error("SoundTouch Worklet 載入失敗，將使用基本中繼節點", e);
        pitchNode = audioCtx.createGain(); 
    }

    // 3. 串接音訊管線: Source -> Pitch -> Vocal Remover -> Destination
    sourceNode.connect(pitchNode);
    pitchNode.connect(vocalRemoverInput);
    
    updateAudioRouting();
}

function setupVocalRemover() {
    vocalRemoverInput = audioCtx.createGain();
    vocalRemoverOutput = audioCtx.createGain();
    
    const splitter = audioCtx.createChannelSplitter(2);
    vocalRemoverInput.connect(splitter);

    const invertRight = audioCtx.createGain();
    invertRight.gain.value = -1;
    splitter.connect(invertRight, 1);

    const merger = audioCtx.createChannelMerger(2);
    splitter.connect(merger, 0, 0); 
    splitter.connect(merger, 0, 1); 
    invertRight.connect(merger, 0, 0); 
    invertRight.connect(merger, 0, 1); 

    const lowPass = audioCtx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 150; 
    vocalRemoverInput.connect(lowPass);

    merger.connect(vocalRemoverOutput);
    lowPass.connect(vocalRemoverOutput);
}

function updateAudioRouting() {
    if (!audioCtx) return;
    pitchNode.disconnect();
    vocalRemoverOutput.disconnect();

    if (isVocalRemovalActive) {
        pitchNode.connect(vocalRemoverInput);
        vocalRemoverOutput.connect(audioCtx.destination);
    } else {
        pitchNode.connect(audioCtx.destination);
    }
}

// 獨立出來的函數：將目前的數值真正套用到音效節點上
function applyPitchSettings() {
    if (!pitchNode) return;
    
    // 方法 A：透過 AudioParam 修改 (涵蓋作者所有可能的參數命名)
    if (pitchNode.parameters) {
        const pFactor = pitchNode.parameters.get('pitch');
        if (pFactor) pFactor.value = currentPitchFactor;
        
        const pSemi = pitchNode.parameters.get('pitchSemitones') || pitchNode.parameters.get('semitones') || pitchNode.parameters.get('semitone shift');
        if (pSemi) pSemi.value = currentSemitones;
    }
    
    // 方法 B：透過 postMessage 修改 (兼容部分必須透過傳訊號來改變狀態的版本)
    if (pitchNode.port) {
        pitchNode.port.postMessage({ type: 'pitch', value: currentPitchFactor });
        pitchNode.port.postMessage({ type: 'pitch', pitch: currentPitchFactor });
    }
}

// 綁定音效 UI
pitchSlider.addEventListener('input', (e) => {
    currentSemitones = parseFloat(e.target.value);
    pitchDisplay.textContent = currentSemitones > 0 ? '+' + currentSemitones : currentSemitones;
    currentPitchFactor = Math.pow(2, currentSemitones / 12);
    
    applyPitchSettings(); // 即時套用
});

vocalToggle.addEventListener('change', (e) => {
    isVocalRemovalActive = e.target.checked;
    updateAudioRouting();
});

// ==========================================
// 播放器邏輯區塊
// ==========================================
function loadPlaylist() {
    fetch(`?folder=${encodeURIComponent(currentFolder)}&ajax=1`)
    .then(res => res.json())
    .then(data => {
        playlist = data.files;
        renderPlaylist();
        if (playlist.length > 0) {
            loadTrack(0, false);
        } else {
            titleEl.textContent = '資料夾內無音樂';
            lyricsText.innerHTML = '<br><br>♪ 空空如也 ♪';
        }
    });
}
loadPlaylist();

folderSelect.addEventListener('change', () => {
    window.location = "?folder=" + encodeURIComponent(folderSelect.value);
});

function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((track, i) => {
        const d = document.createElement('div');
        d.className = 'item' + (i === currentIndex ? ' active' : '');
        d.innerHTML = `<span>${String(i+1).padStart(2,'0')}</span><div class="item-title">${track.original}</div>`;
        d.onclick = () => { loadTrack(i, true); };
        playlistEl.appendChild(d);
    });
}

function loadTrack(idx, autoPlay = true) {
    if (playlist.length === 0) return;
    currentIndex = idx;
    const track = playlist[idx];
    
    audio.src = track.public_base + '/' + track.encoded;
    titleEl.textContent = track.original;
    bar.style.width = '0%';
    cur.textContent = '0:00';
    dur.textContent = '0:00';
    
    [...playlistEl.children].forEach((el, i) => el.classList.toggle('active', i === idx));
    fetchLyrics(track);

    if (autoPlay) {
        initAudioFX().then(() => audio.play());
    }
}

playBtn.onclick = async () => {
    if (playlist.length === 0) return;
    
    await initAudioFX();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    playing ? audio.pause() : audio.play();
};

function playNext(force = false) {
    if (playlist.length === 0) return;
    let mode = playModes[currentModeIdx].id;
    
    if (mode === 'shuffle') {
        let n = Math.floor(Math.random() * playlist.length);
        if (n === currentIndex && playlist.length > 1) n = (n + 1) % playlist.length;
        loadTrack(n);
    } else if (mode === 'repeat-one' && !force) {
        audio.currentTime = 0;
        audio.play();
    } else {
        if (currentIndex < playlist.length - 1) {
            loadTrack(currentIndex + 1);
        } else if (mode === 'repeat-all') {
            loadTrack(0);
        } else {
            audio.pause();
        }
    }
}

function playPrev() {
    if (playlist.length === 0) return;
    if (playModes[currentModeIdx].id === 'shuffle') {
        loadTrack(Math.floor(Math.random() * playlist.length));
    } else if (currentIndex > 0) {
        loadTrack(currentIndex - 1);
    } else if (playModes[currentModeIdx].id === 'repeat-all') {
        loadTrack(playlist.length - 1);
    } else {
        audio.currentTime = 0;
    }
}

nextBtn.onclick = () => playNext(true);
prevBtn.onclick = playPrev;

modeBtn.onclick = () => {
    currentModeIdx = (currentModeIdx + 1) % playModes.length;
    let mode = playModes[currentModeIdx];
    modeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${mode.icon}</svg>`;
    modeStatus.textContent = mode.name;
    modeBtn.classList.add('active');
    setTimeout(()=> modeBtn.classList.remove('active'), 200);
};

audio.onplay = () => { playing = true; playBtn.innerHTML = icons.pause; };
audio.onpause = () => { playing = false; playBtn.innerHTML = icons.play; };
audio.onloadedmetadata = () => dur.textContent = fmt(audio.duration);
audio.onended = () => playNext(false);

audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const pct = audio.currentTime / audio.duration;
    bar.style.width = (pct * 100) + '%';
    cur.textContent = fmt(audio.currentTime);

    if (rawLyrics && rawLyrics.trim() !== '') {
        const textHeight = lyricsText.offsetHeight;
        const offset = textHeight * pct;
        lyricsText.style.transform = `translateY(-${offset}px)`;
    }
};

progress.onclick = e => {
    if (!audio.duration) return;
    const r = progress.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
};

// ==========================================
// 歌詞 AJAX 與編輯區塊
// ==========================================
function fetchLyrics(track) {
    rawLyrics = '';
    lyricsText.style.transform = 'translateY(0)';
    lyricsText.innerHTML = '<br><br>♪ 讀取中 ♪';

    fetch(`?action=load_lyrics&folder_key=${encodeURIComponent(track.folder_key)}&filename_base=${encodeURIComponent(track.filename_base)}`)
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success' && data.lyrics.trim() !== '') {
            rawLyrics = data.lyrics;
            lyricsText.textContent = rawLyrics;
        } else {
            rawLyrics = '';
            lyricsText.innerHTML = '<br><br>♪ 暫無歌詞 ♪';
        }
    }).catch(() => {
        lyricsText.innerHTML = '<br><br>♪ 讀取失敗 ♪';
    });
}

document.getElementById('editLyricsBtnIcon').onclick = () => {
    if (playlist.length === 0) return;
    const track = playlist[currentIndex];
    modalTitle.textContent = "編輯歌詞 - " + track.original;
    lyricsInput.value = rawLyrics;
    lyricsModal.style.display = 'flex';
};

const closeModal = () => { lyricsModal.style.display = 'none'; };
closeModalBtn.onclick = closeModal;
cancelLyricsBtn.onclick = closeModal;

saveLyricsBtn.onclick = () => {
    const track = playlist[currentIndex];
    const newLyrics = lyricsInput.value;
    
    const formData = new FormData();
    formData.append('action', 'save_lyrics');
    formData.append('folder_key', track.folder_key);
    formData.append('filename_base', track.filename_base);
    formData.append('lyrics_content', newLyrics);

    fetch(location.pathname, { method: 'POST', body: formData })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            rawLyrics = newLyrics;
            lyricsText.textContent = rawLyrics || '\n\n♪ 暫無歌詞 ♪';
            lyricsText.style.transform = 'translateY(0)'; 
            closeModal();
            alert('歌詞已儲存成功！');
        } else {
            alert('儲存失敗：' + data.message);
        }
    })
    .catch(() => alert('儲存發生網路錯誤'));
};

lyricsModal.onclick = (e) => {
    if (e.target === lyricsModal) closeModal();
};
