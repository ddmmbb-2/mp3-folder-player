<?php
/************************************************
 * 純 mp3/子資料夾 MP3 播放器 (前後端分離版)
 ************************************************/

ob_start();
mb_internal_encoding("UTF-8");
setlocale(LC_ALL, 'C.UTF-8');

// 設定音樂根目錄為「本程式目錄下的 mp3 資料夾」
$mp3_base_dir = __DIR__ . "/mp3";

// 掃描 mp3 資料夾下的一級子資料夾，每個子資料夾視為一個「音樂資料夾」
function scanMp3Subfolders($base_dir) {
    $folders = [];
    if (!is_dir($base_dir)) return $folders;

    // 取得當前 PHP 檔案所在的目錄路徑（相對於網站根目錄）
    $base_url = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
    
    foreach (scandir($base_dir) as $item) {
        if ($item === '.' || $item === '..') continue;
        $full_path = $base_dir . "/" . $item;
        if (is_dir($full_path) && glob($full_path . "/*.mp3")) {
            $folders[$item] = [
                "local"  => $full_path,
                "public" => $base_url . "/mp3/" . $item   // 例如 /myplayer/mp3/絕地戰兵
            ];
        }
    }
    return $folders;
}

$music_folders = scanMp3Subfolders($mp3_base_dir);

// 若沒有任何子資料夾包含 MP3，則不顯示任何選項（播放清單會是空的）
$selected_folder = (isset($_GET['folder']) && isset($music_folders[$_GET['folder']]))
    ? $_GET['folder']
    : (empty($music_folders) ? '' : array_key_first($music_folders));

// ---------- 檔案上傳邏輯 ----------
$upload_message = "";
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['mp3_file'])) {
    if ($_FILES['mp3_file']['error'] === UPLOAD_ERR_OK) {
        $upload_folder_key = $_POST['upload_folder'] ?? "";
        if (isset($music_folders[$upload_folder_key])) {
            $target_dir = $music_folders[$upload_folder_key]["local"];
            if (!is_dir($target_dir)) {
                mkdir($target_dir, 0775, true);   // 若資料夾意外消失則重建
            }
            $filename = $_FILES['mp3_file']['name'];
            $destination = $target_dir . "/" . $filename;
            if (move_uploaded_file($_FILES['mp3_file']['tmp_name'], $destination)) {
                $upload_message = "上傳成功：{$filename}";
            } else {
                $upload_message = "上傳失敗：無法移動檔案。";
            }
        } else {
            $upload_message = "上傳失敗：指定的資料夾不存在。";
        }
    } else {
        $upload_message = "上傳失敗：錯誤代碼 " . $_FILES['mp3_file']['error'];
    }
}

// ---------- 儲存歌詞 (POST) ----------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'save_lyrics') {
    ob_clean(); header('Content-Type: application/json; charset=UTF-8');
    $folder_key    = $_POST['folder_key']    ?? '';
    $filename_base = $_POST['filename_base'] ?? '';
    $lyrics        = $_POST['lyrics_content'] ?? '';

    if (!isset($music_folders[$folder_key])) { echo json_encode(['status'=>'error','message'=>'指定資料夾不存在']); exit; }
    if ($filename_base === '' || preg_match('/[\/\\\\]/', $filename_base)) { echo json_encode(['status'=>'error','message'=>'檔名不合法']); exit; }

    $dir = $music_folders[$folder_key]['local'];
    if (!is_dir($dir)) { if (!@mkdir($dir, 0775, true)) { echo json_encode(['status'=>'error','message'=>'資料夾無法建立']); exit; } }
    if (!is_writable($dir)) { echo json_encode(['status'=>'error','message'=>'資料夾不可寫入']); exit; }

    $path = $dir . '/' . $filename_base . '.txt';
    $ok   = @file_put_contents($path, $lyrics, LOCK_EX);

    if ($ok !== false) { echo json_encode(['status'=>'success','message'=>'歌詞已儲存。'], JSON_UNESCAPED_UNICODE); } 
    else { echo json_encode(['status'=>'error','message'=>'無法寫入檔案']); }
    exit;
}

// ---------- 讀取歌詞 (GET) ----------
if (isset($_GET['action']) && $_GET['action'] === 'load_lyrics') {
    ob_clean(); header('Content-Type: application/json; charset=UTF-8');
    $folder_key    = $_GET['folder_key']    ?? '';
    $filename_base = $_GET['filename_base'] ?? '';
    if (!isset($music_folders[$folder_key])) { echo json_encode(['status'=>'error','message'=>'不存在']); exit; }
    
    $dir = $music_folders[$folder_key]['local'];
    $lyrics_path = $dir . '/' . $filename_base . '.txt';

    if (file_exists($lyrics_path)) {
        $lyrics = file_get_contents($lyrics_path);
        if (function_exists('mb_convert_encoding')) { $lyrics = mb_convert_encoding($lyrics, 'UTF-8', 'UTF-8, BIG5, GBK, CP950'); }
        echo json_encode(['status'=>'success','lyrics'=>$lyrics], JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode(['status'=>'not_found','lyrics'=>'']);
    }
    exit;
}

// ---------- 取得播放清單 (AJAX) ----------
if (isset($_GET['ajax'])) {
    ob_clean(); header('Content-Type: application/json; charset=UTF-8');
    $mp3_files = [];
    if ($selected_folder !== '' && isset($music_folders[$selected_folder])) {
        $dir_info = $music_folders[$selected_folder];
        if (is_dir($dir_info["local"])) {
            foreach (glob($dir_info["local"] . "/*.mp3") as $file) {
                $original_name = basename($file);
                $mp3_files[] = [
                    "original"      => $original_name,
                    "encoded"       => rawurlencode($original_name),
                    "public_base"   => $dir_info["public"],
                    "folder_key"    => $selected_folder,
                    "filename_base" => pathinfo($original_name, PATHINFO_FILENAME)
                ];
            }
        }
    }
    echo json_encode(["files" => $mp3_files]);
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
?>
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>極致音樂播放器 · 僅讀取 mp3 子資料夾</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<div class="container">
    <div class="player" id="player">
      <div class="main">
        <div class="art">
            <div class="lyrics-mask">
                <div class="lyrics-overlay" id="lyrics-text"><br><br>♪ 讀取中 ♪</div>
            </div>
        </div>
        <div>
          <h1 id="title">—</h1>
          <div class="sub">
              <span></span>
              <span class="sub-status" id="modeStatus">單曲播放</span>
          </div>
        </div>
        <div class="progress-wrap">
          <div class="progress" id="progress"><div id="bar"></div></div>
          <div class="time"><span id="cur">0:00</span><span id="dur">0:00</span></div>
        </div>
        
        <div class="fx-controls">
            <div class="fx-item">
                <label for="pitchSlider">音調 (Key): <span id="pitchDisplay">0</span></label>
                <input type="range" id="pitchSlider" min="-12" max="12" step="1" value="0">
            </div>
            <div class="fx-item">
                <label for="vocalToggle" class="vocal-label">
                    <input type="checkbox" id="vocalToggle"> 開啟去人聲 (伴唱模式)
                </label>
            </div>
        </div>

        <div class="controls">
          <button class="btn" id="modeBtn" title="切換播放模式"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>
          <button class="btn" id="prev" aria-label="prev"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg></button>
          <button class="btn play" id="play" aria-label="play"></button>
          <button class="btn" id="next" aria-label="next"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z"/></svg></button>
          <button class="btn" id="editLyricsBtnIcon" title="編輯歌詞"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
        </div>
      </div>
      <div class="list">
        <div class="glass-select-wrap">
            <select id="folderSelect" class="glass-select">
                <?php foreach ($music_folders as $key => $info): ?>
                <option value="<?= htmlspecialchars($key) ?>" <?= ($key === $selected_folder) ? "selected" : "" ?>>
                    📂 <?= htmlspecialchars($key) ?>
                </option>
                <?php endforeach; ?>
                <?php if (empty($music_folders)): ?>
                <option disabled>⚠️ 尚未有任何含有 MP3 的子資料夾</option>
                <?php endif; ?>
            </select>
        </div>
        <div id="playlist"></div>
      </div>
    </div>

    <div class="upload-section">
        <form method="post" enctype="multipart/form-data" class="upload-form">
            <input type="hidden" name="upload_folder" value="<?= htmlspecialchars($selected_folder) ?>">
            <input type="file" name="mp3_file" accept=".mp3" required>
            <button type="submit" class="btn-upload">上傳至此資料夾</button>
        </form>
        <?php if (!empty($upload_message)): ?>
            <div class="msg"><?= htmlspecialchars($upload_message) ?></div>
        <?php endif; ?>
    </div>
</div>

<div id="lyricsModal" class="modal">
    <div class="modal-content">
        <div class="modal-header">
            <h2 id="modalTitle">編輯歌詞</h2>
            <button class="close-btn" id="closeModalBtn">&times;</button>
        </div>
        <textarea id="lyricsInput" class="lyrics-textarea" placeholder="在此輸入或貼上歌詞..."></textarea>
        <div class="modal-footer">
            <button class="btn-glass" id="cancelLyricsBtn">取消</button>
            <button class="btn-glass primary" id="saveLyricsBtn">儲存變更</button>
        </div>
    </div>
</div>

<audio id="audio" crossorigin="anonymous"></audio>

<script>
    window.PLAYER_CONFIG = {
        currentFolder: "<?= htmlspecialchars($selected_folder) ?>"
    };
</script>

<script src="player.js"></script>

</body>
</html>