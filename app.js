(() => {
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const paper = $('paper');
  const title = $('docTitle');
  const saveState = $('saveState');
  const charCount = $('charCount');
  const directionBtn = $('directionBtn');
  const directionState = $('directionState');
  const paperState = $('paperState');
  const menuPanel = $('menuPanel');
  const STORAGE_KEY = 'tategaki-docs-v002';
  const LEGACY_STORAGE_KEY = 'tategaki-docs-v001';
  let saveTimer = null;
  let currentDirection = 'vertical';
  let currentPaperSize = 'A4';
  let currentPaperOrientation = 'portrait';
  let lastFindIndex = -1;

  const PAPER_SIZES = {
    A4: { label: 'A4', width: 210, height: 297 },
    A5: { label: 'A5', width: 148, height: 210 },
    B5: { label: 'B5', width: 182, height: 257 },
    B6: { label: 'B6', width: 128, height: 182 },
    LETTER: { label: 'Letter', width: 215.9, height: 279.4 }
  };

  const menuDefinitions = {
    file: [
      ['新規', 'Ctrl+Alt+N', newDocument],
      ['sep'],
      ['TXTで書き出し', '', exportTxt],
      ['Word(.doc)で書き出し', '', exportDoc],
      ['HTMLで書き出し', '', exportHtml],
      ['sep'],
      ['印刷', 'Ctrl+P', printDocument]
    ],
    edit: [
      ['元に戻す', 'Ctrl+Z', () => cmd('undo')],
      ['やり直す', 'Ctrl+Y', () => cmd('redo')],
      ['sep'],
      ['切り取り', 'Ctrl+X', () => cmd('cut')],
      ['コピー', 'Ctrl+C', () => cmd('copy')],
      ['貼り付け', 'Ctrl+V', () => navigator.clipboard?.readText().then(t => cmd('insertText', t)).catch(() => {})],
      ['sep'],
      ['すべて選択', 'Ctrl+A', () => cmd('selectAll')]
    ],
    view: [
      ['縦書き / 横書き 切替', '', toggleDirection],
      ['sep'],
      ['A4', '', () => setPaperSize('A4')],
      ['A5', '', () => setPaperSize('A5')],
      ['B5', '', () => setPaperSize('B5')],
      ['B6', '', () => setPaperSize('B6')],
      ['Letter', '', () => setPaperSize('LETTER')],
      ['sep'],
      ['用紙を縦長にする', '', () => setPaperOrientation('portrait')],
      ['用紙を横長にする', '', () => setPaperOrientation('landscape')],
      ['sep'],
      ['75%', '', () => setZoom(.75)],
      ['100%', '', () => setZoom(1)],
      ['125%', '', () => setZoom(1.25)],
      ['150%', '', () => setZoom(1.5)]
    ],
    insert: [
      ['改ページ', 'Ctrl+Enter', insertPageBreak],
      ['現在日時', '', () => cmd('insertText', new Date().toLocaleString('ja-JP'))]
    ],
    format: [
      ['太字', 'Ctrl+B', () => cmd('bold')],
      ['斜体', 'Ctrl+I', () => cmd('italic')],
      ['下線', 'Ctrl+U', () => cmd('underline')],
      ['sep'],
      ['標準テキスト', '', () => formatBlock('p')],
      ['見出し 1', '', () => formatBlock('h1')],
      ['見出し 2', '', () => formatBlock('h2')]
    ],
    tools: [
      ['検索と置換', 'Ctrl+F', openFind],
      ['文字数を表示', '', () => alert(`${countChars()} 文字`)]
    ]
  };

  function cmd(name, value = null) {
    editor.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(name, false, value);
    scheduleSave();
    updateCount();
  }

  function formatBlock(tag) {
    editor.focus();
    document.execCommand('formatBlock', false, tag);
    scheduleSave();
  }

  function insertPageBreak() {
    cmd('insertHTML', '<div style="break-before:page;page-break-before:always;"><br></div>');
  }

  function getPaperDimensions() {
    const size = PAPER_SIZES[currentPaperSize] || PAPER_SIZES.A4;
    const landscape = currentPaperOrientation === 'landscape';
    return {
      width: landscape ? size.height : size.width,
      height: landscape ? size.width : size.height
    };
  }

  function applyPaperSettings({ save = true } = {}) {
    const { width, height } = getPaperDimensions();
    paper.style.width = `${width}mm`;
    paper.style.minWidth = `${width}mm`;
    paper.style.height = `${height}mm`;
    paper.dataset.size = currentPaperSize;
    paper.dataset.orientation = currentPaperOrientation;

    $('paperSizeSelect').value = currentPaperSize;
    $('paperOrientationSelect').value = currentPaperOrientation;
    const label = PAPER_SIZES[currentPaperSize]?.label || currentPaperSize;
    const orientationLabel = currentPaperOrientation === 'landscape' ? '横長' : '縦長';
    paperState.textContent = `${label} / ${orientationLabel}`;

    const cssPxPerMm = 96 / 25.4;
    document.documentElement.style.setProperty('--ruler-width', `${Math.round(width * cssPxPerMm)}px`);
    updateZoomSpacing();
    updatePrintStyle();
    if (save) scheduleSave();
  }

  function setPaperSize(size) {
    if (!PAPER_SIZES[size]) return;
    currentPaperSize = size;
    applyPaperSettings();
    editor.focus();
  }

  function setPaperOrientation(orientation) {
    if (!['portrait', 'landscape'].includes(orientation)) return;
    currentPaperOrientation = orientation;
    applyPaperSettings();
    editor.focus();
  }

  function setZoom(value) {
    $('zoomSelect').value = String(value);
    paper.style.transform = `scale(${value})`;
    updateZoomSpacing();
    scheduleSave();
  }

  function updateZoomSpacing() {
    const value = Number($('zoomSelect').value || 1);
    const { height } = getPaperDimensions();
    const cssPxPerMm = 96 / 25.4;
    const paperHeightPx = height * cssPxPerMm;
    const marginBottom = Math.max(0, (value - 1) * paperHeightPx);
    $('paperStage').style.paddingBottom = `${60 + marginBottom}px`;
  }

  function toggleDirection() {
    currentDirection = currentDirection === 'vertical' ? 'horizontal' : 'vertical';
    applyDirection();
    scheduleSave();
    editor.focus();
  }

  function applyDirection() {
    paper.classList.toggle('vertical', currentDirection === 'vertical');
    paper.classList.toggle('horizontal', currentDirection === 'horizontal');
    directionBtn.textContent = currentDirection === 'vertical' ? '縦書き' : '横書き';
    directionBtn.setAttribute('aria-pressed', currentDirection === 'vertical' ? 'true' : 'false');
    directionState.textContent = currentDirection === 'vertical' ? '縦書き / 右→左' : '横書き / 左→右';
  }

  function countChars() {
    return (editor.innerText || '').replace(/\s/g, '').length;
  }
  function updateCount() { charCount.textContent = `${countChars().toLocaleString('ja-JP')} 文字`; }

  function scheduleSave() {
    saveState.textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDocument, 500);
  }

  function saveDocument() {
    const data = {
      title: title.value,
      html: editor.innerHTML,
      direction: currentDirection,
      zoom: Number($('zoomSelect').value),
      paperSize: currentPaperSize,
      paperOrientation: currentPaperOrientation,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    saveState.textContent = '保存済み';
  }

  function loadDocument() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let migrated = false;
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        migrated = Boolean(raw);
      }
      const data = JSON.parse(raw || 'null');
      if (!data) {
        applyDirection();
        applyPaperSettings({ save: false });
        setZoom(1);
        return;
      }
      title.value = data.title || '無題のドキュメント';
      editor.innerHTML = data.html || '';
      currentDirection = data.direction === 'horizontal' ? 'horizontal' : 'vertical';
      currentPaperSize = PAPER_SIZES[data.paperSize] ? data.paperSize : 'A4';
      currentPaperOrientation = data.paperOrientation === 'landscape' ? 'landscape' : 'portrait';
      applyDirection();
      applyPaperSettings({ save: false });
      setZoom(data.zoom || 1);
      if (migrated) saveDocument();
      saveState.textContent = '保存済み';
      updateCount();
    } catch (e) {
      console.warn('保存データを読み込めませんでした。', e);
      applyDirection();
      applyPaperSettings({ save: false });
    }
  }

  function newDocument() {
    if ((editor.innerText || '').trim() && !confirm('現在の内容を消して新しい文書を作成しますか？')) return;
    title.value = '無題のドキュメント';
    editor.innerHTML = '';
    currentDirection = 'vertical';
    currentPaperSize = 'A4';
    currentPaperOrientation = 'portrait';
    paper.className = 'paper vertical';
    applyDirection();
    applyPaperSettings({ save: false });
    $('zoomSelect').value = '1';
    setZoom(1);
    localStorage.removeItem(STORAGE_KEY);
    updateCount();
    saveState.textContent = '保存済み';
    editor.focus();
  }

  function safeFilename() {
    const raw = (title.value || '無題のドキュメント').trim();
    return raw.replace(/[\\/:*?"<>|]/g, '_') || '無題のドキュメント';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTxt() {
    downloadBlob(new Blob([editor.innerText || ''], {type:'text/plain;charset=utf-8'}), `${safeFilename()}.txt`);
  }

  function documentHtml() {
    const vertical = currentDirection === 'vertical';
    const { width, height } = getPaperDimensions();
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title.value)}</title><style>
@page{size:${width}mm ${height}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
body{width:${width}mm;min-height:${height}mm;padding:18mm;box-sizing:border-box;font-family:'Yu Mincho','Hiragino Mincho ProN',serif;font-size:12pt;line-height:2;${vertical ? 'writing-mode:vertical-rl;text-orientation:mixed;' : ''}}
h1{font-size:20pt}h2{font-size:16pt}blockquote{border-inline-start:3px solid #999;padding-inline-start:.8em}
</style></head><body>${editor.innerHTML}</body></html>`;
  }

  function exportDoc() {
    const bom = '\ufeff';
    downloadBlob(new Blob([bom + documentHtml()], {type:'application/msword;charset=utf-8'}), `${safeFilename()}.doc`);
  }

  function exportHtml() {
    downloadBlob(new Blob([documentHtml()], {type:'text/html;charset=utf-8'}), `${safeFilename()}.html`);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function updatePrintStyle() {
    const { width, height } = getPaperDimensions();
    let style = document.getElementById('dynamicPrintStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'dynamicPrintStyle';
      document.head.appendChild(style);
    }
    style.textContent = `@page{size:${width}mm ${height}mm;margin:0}@media print{.paper{width:${width}mm!important;min-width:${width}mm!important;height:${height}mm!important}}`;
  }

  function printDocument() {
    updatePrintStyle();
    window.print();
  }

  function openFind() {
    $('findDialog').showModal();
    $('findInput').focus();
    $('findInput').select();
    lastFindIndex = -1;
  }

  function findNext() {
    const term = $('findInput').value;
    const text = editor.innerText || '';
    if (!term) return;
    lastFindIndex = text.indexOf(term, lastFindIndex + 1);
    if (lastFindIndex < 0) lastFindIndex = text.indexOf(term);
    $('findMessage').textContent = lastFindIndex >= 0 ? `見つかりました（${lastFindIndex + 1}文字目付近）` : '見つかりませんでした。';
    if (lastFindIndex >= 0) selectTextByOffset(lastFindIndex, term.length);
  }

  function selectTextByOffset(start, length) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node, offset = 0, startNode = null, endNode = null, startOffset = 0, endOffset = 0;
    while ((node = walker.nextNode())) {
      const next = offset + node.nodeValue.length;
      if (!startNode && start >= offset && start <= next) { startNode = node; startOffset = start - offset; }
      if (startNode && start + length >= offset && start + length <= next) { endNode = node; endOffset = start + length - offset; break; }
      offset = next;
    }
    if (startNode && endNode) {
      const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); editor.focus();
    }
  }

  function replaceOne() {
    const term = $('findInput').value;
    const replacement = $('replaceInput').value;
    if (!term) return;
    const sel = window.getSelection();
    if (sel && sel.toString() === term) {
      cmd('insertText', replacement);
      $('findMessage').textContent = '1件置換しました。';
      lastFindIndex = -1;
    } else {
      findNext();
    }
  }

  function replaceAll() {
    const term = $('findInput').value;
    const replacement = $('replaceInput').value;
    if (!term) return;
    const plain = editor.innerText || '';
    const count = plain.split(term).length - 1;
    if (!count) { $('findMessage').textContent = '見つかりませんでした。'; return; }
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = []; let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => { node.nodeValue = node.nodeValue.split(term).join(replacement); });
    $('findMessage').textContent = `${count}件置換しました。`;
    scheduleSave(); updateCount();
  }

  function showMenu(button, key) {
    const defs = menuDefinitions[key] || [];
    menuPanel.innerHTML = '';
    defs.forEach(item => {
      if (item[0] === 'sep') { const sep = document.createElement('div'); sep.className = 'menu-sep'; menuPanel.appendChild(sep); return; }
      const [label, shortcut, action] = item;
      const btn = document.createElement('button'); btn.className = 'menu-item';
      btn.innerHTML = `<span>${label}</span><span class="shortcut">${shortcut || ''}</span>`;
      btn.addEventListener('click', () => { hideMenu(); action(); });
      menuPanel.appendChild(btn);
    });
    const rect = button.getBoundingClientRect();
    menuPanel.style.left = `${rect.left}px`;
    menuPanel.style.top = `${rect.bottom + 2}px`;
    menuPanel.hidden = false;
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.toggle('active', b === button));
  }

  function hideMenu() {
    menuPanel.hidden = true;
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
  }

  document.querySelectorAll('.menu-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menuPanel.hidden && btn.classList.contains('active')) hideMenu();
    else showMenu(btn, btn.dataset.menu);
  }));
  document.addEventListener('click', (e) => { if (!menuPanel.contains(e.target)) hideMenu(); });

  editor.addEventListener('input', () => { scheduleSave(); updateCount(); });
  title.addEventListener('input', scheduleSave);
  $('newDoc').addEventListener('click', newDocument);
  $('exportBtn').addEventListener('click', () => $('exportDialog').showModal());
  $('printBtn').addEventListener('click', printDocument);
  $('undoBtn').addEventListener('click', () => cmd('undo'));
  $('redoBtn').addEventListener('click', () => cmd('redo'));
  $('boldBtn').addEventListener('click', () => cmd('bold'));
  $('italicBtn').addEventListener('click', () => cmd('italic'));
  $('underlineBtn').addEventListener('click', () => cmd('underline'));
  $('findBtn').addEventListener('click', openFind);
  directionBtn.addEventListener('click', toggleDirection);
  $('zoomSelect').addEventListener('change', (e) => setZoom(Number(e.target.value)));
  $('paperSizeSelect').addEventListener('change', (e) => setPaperSize(e.target.value));
  $('paperOrientationSelect').addEventListener('change', (e) => setPaperOrientation(e.target.value));
  $('blockSelect').addEventListener('change', (e) => formatBlock(e.target.value));
  $('fontSelect').addEventListener('change', (e) => cmd('fontName', e.target.value));
  $('fontSizeSelect').addEventListener('change', (e) => cmd('fontSize', e.target.value));
  $('findNextBtn').addEventListener('click', findNext);
  $('replaceOneBtn').addEventListener('click', replaceOne);
  $('replaceAllBtn').addEventListener('click', replaceAll);
  $('closeFindBtn').addEventListener('click', () => $('findDialog').close());
  $('exportTxtBtn').addEventListener('click', exportTxt);
  $('exportDocBtn').addEventListener('click', exportDoc);
  $('exportHtmlBtn').addEventListener('click', exportHtml);
  $('closeExportBtn').addEventListener('click', () => $('exportDialog').close());

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDocument(); }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); insertPageBreak(); }
    if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newDocument(); }
  });

  window.addEventListener('beforeunload', saveDocument);
  loadDocument();
  updateCount();
})();
