(() => {
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const paper = $('paper');
  const title = $('docTitle');
  const saveState = $('saveState');
  const charCount = $('charCount');
  const directionBtn = $('directionBtn');
  const latinOrientationBtn = $('latinOrientationBtn');
  const directionState = $('directionState');
  const paperState = $('paperState');
  const menuPanel = $('menuPanel');
  const tabsList = $('tabsList');
  const STORAGE_KEY = 'tategaki-docs-v004';
  const LEGACY_STORAGE_KEYS = ['tategaki-docs-v003', 'tategaki-docs-v002', 'tategaki-docs-v001'];
  let saveTimer = null;
  let currentDirection = 'vertical';
  let currentLatinOrientation = 'mixed';
  let currentPaperSize = 'A4';
  let currentPaperOrientation = 'portrait';
  let lastFindIndex = -1;
  let tabs = [];
  let activeTabId = null;
  let savedEditorRange = null;

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
      ['PDFで書き出し', '', exportPdf],
      ['HTMLで書き出し', '', exportHtml],
      ['IDMLで書き出し', '', exportIdml],
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
      ['英字の向き 切替', '', toggleLatinOrientation],
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
    syncActiveTab();
    scheduleSave();
    updateCount();
  }

  function formatBlock(tag) {
    editor.focus();
    document.execCommand('formatBlock', false, tag);
    syncActiveTab();
    scheduleSave();
  }

  function restoreEditorSelection() {
    if (!savedEditorRange) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedEditorRange.cloneRange());
    return true;
  }

  function rememberEditorSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const node = common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode;
    if (node && editor.contains(node)) savedEditorRange = range.cloneRange();
  }

  function applyFontSize(pt) {
    const size = Math.max(6, Math.min(200, Number(pt) || 12));
    $('fontSizeInput').value = String(size);
    editor.focus();
    restoreEditorSelection();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    document.execCommand('styleWithCSS', false, true);
    normalizeCustomFontSizes(size);
    rememberEditorSelection();
    syncActiveTab();
    scheduleSave();
  }

  function normalizeCustomFontSizes(pt) {
    editor.querySelectorAll('font[size="7"]').forEach((node) => {
      node.removeAttribute('size');
      node.style.fontSize = `${pt}pt`;
    });
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

  function selectionIsInsideEditor(range) {
    if (!range) return false;
    const common = range.commonAncestorContainer;
    const node = common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode;
    return !!(node && editor.contains(node));
  }

  function selectedTextOrientation(range) {
    if (!range) return currentLatinOrientation;
    const container = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    if (!container) return currentLatinOrientation;
    const inline = container.closest?.('[data-latin-orientation]');
    if (inline && editor.contains(inline)) return inline.dataset.latinOrientation || currentLatinOrientation;
    return currentLatinOrientation;
  }

  function wrapSelectedTextOrientation(orientation) {
    restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !selectionIsInsideEditor(range)) return false;

    const fragment = range.extractContents();
    const span = document.createElement('span');
    span.dataset.latinOrientation = orientation;
    span.style.textOrientation = orientation;
    span.appendChild(fragment);
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    savedEditorRange = nextRange.cloneRange();
    syncActiveTab();
    scheduleSave();
    updateCount();
    return true;
  }

  function toggleLatinOrientation() {
    const range = savedEditorRange?.cloneRange();
    if (range && !range.collapsed && selectionIsInsideEditor(range)) {
      const current = selectedTextOrientation(range);
      const next = current === 'upright' ? 'mixed' : 'upright';
      if (wrapSelectedTextOrientation(next)) {
        latinOrientationBtn.textContent = next === 'upright' ? '英字：縦' : '英字：横';
        latinOrientationBtn.setAttribute('aria-pressed', next === 'upright' ? 'true' : 'false');
        editor.focus();
        return;
      }
    }

    currentLatinOrientation = currentLatinOrientation === 'mixed' ? 'upright' : 'mixed';
    applyDirection();
    scheduleSave();
    editor.focus();
  }

  function applyDirection() {
    paper.classList.toggle('vertical', currentDirection === 'vertical');
    paper.classList.toggle('horizontal', currentDirection === 'horizontal');
    paper.classList.toggle('latin-upright', currentLatinOrientation === 'upright');
    directionBtn.textContent = currentDirection === 'vertical' ? '縦書き' : '横書き';
    directionBtn.setAttribute('aria-pressed', currentDirection === 'vertical' ? 'true' : 'false');
    latinOrientationBtn.textContent = currentLatinOrientation === 'upright' ? '英字：縦' : '英字：横';
    latinOrientationBtn.setAttribute('aria-pressed', currentLatinOrientation === 'upright' ? 'true' : 'false');
    latinOrientationBtn.disabled = currentDirection !== 'vertical';
    directionState.textContent = currentDirection === 'vertical' ? '縦書き / 右→左' : '横書き / 左→右';
  }

  function countText(text) {
    return String(text || '').replace(/\s/g, '').length;
  }

  function countHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return countText(temp.innerText || temp.textContent || '');
  }

  function countChars() {
    return countText(editor.innerText || '');
  }

  function updateCount() {
    const count = countChars();
    charCount.textContent = `${count.toLocaleString('ja-JP')} 文字`;
    renderTabs();
  }

  function createTab(name, html = '') {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { id, name, html };
  }

  function syncActiveTab() {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.html = editor.innerHTML;
  }

  function renderTabs() {
    tabsList.innerHTML = '';
    tabs.forEach((tab, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `doc-tab${tab.id === activeTabId ? ' active' : ''}`;
      btn.title = tab.name || `タブ${index + 1}`;
      const html = tab.id === activeTabId ? editor.innerHTML : tab.html;
      const count = countHtml(html);
      btn.innerHTML = `<span class="tab-label">${escapeHtml(tab.name || `タブ${index + 1}`)}</span><span class="tab-count">${count.toLocaleString('ja-JP')}字</span>`;
      btn.title = `${tab.name || `タブ${index + 1}`}（ダブルクリックで名前変更）`;
      btn.addEventListener('click', () => switchTab(tab.id));
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        renameTab(tab.id);
      });
      tabsList.appendChild(btn);
    });
  }

  function switchTab(id) {
    if (id === activeTabId) return;
    syncActiveTab();
    const target = tabs.find(t => t.id === id);
    if (!target) return;
    activeTabId = id;
    editor.innerHTML = target.html || '';
    lastFindIndex = -1;
    updateCount();
    scheduleSave();
    editor.focus();
  }

  function addTab() {
    syncActiveTab();
    const tab = createTab(`タブ${tabs.length + 1}`);
    tabs.push(tab);
    activeTabId = tab.id;
    editor.innerHTML = '';
    updateCount();
    scheduleSave();
    editor.focus();
  }

  function renameTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const next = prompt('タブ名を変更', tab.name || '');
    if (next === null) return;
    const name = next.trim();
    if (!name) return;
    tab.name = name;
    renderTabs();
    scheduleSave();
  }

  function scheduleSave() {
    saveState.textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDocument, 500);
  }

  function saveDocument() {
    syncActiveTab();
    const data = {
      title: title.value,
      tabs,
      activeTabId,
      direction: currentDirection,
      latinOrientation: currentLatinOrientation,
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
        for (const key of LEGACY_STORAGE_KEYS) {
          raw = localStorage.getItem(key);
          if (raw) { migrated = true; break; }
        }
      }
      const data = JSON.parse(raw || 'null');
      if (!data) {
        const first = createTab('タブ1');
        tabs = [first];
        activeTabId = first.id;
        applyDirection();
        applyPaperSettings({ save: false });
        setZoom(1);
        renderTabs();
        return;
      }

      title.value = data.title || '無題のドキュメント';
      if (Array.isArray(data.tabs) && data.tabs.length) {
        tabs = data.tabs.map((tab, index) => ({
          id: tab.id || `tab-restored-${index + 1}`,
          name: tab.name || `タブ${index + 1}`,
          html: tab.html || ''
        }));
        activeTabId = tabs.some(t => t.id === data.activeTabId) ? data.activeTabId : tabs[0].id;
      } else {
        const first = createTab('タブ1', data.html || '');
        tabs = [first];
        activeTabId = first.id;
      }
      const active = tabs.find(t => t.id === activeTabId) || tabs[0];
      editor.innerHTML = active.html || '';
      currentDirection = data.direction === 'horizontal' ? 'horizontal' : 'vertical';
      currentLatinOrientation = data.latinOrientation === 'upright' ? 'upright' : 'mixed';
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
      const first = createTab('タブ1');
      tabs = [first];
      activeTabId = first.id;
      applyDirection();
      applyPaperSettings({ save: false });
      renderTabs();
    }
  }

  function newDocument() {
    const hasText = tabs.some(tab => countHtml(tab.id === activeTabId ? editor.innerHTML : tab.html) > 0);
    if (hasText && !confirm('現在の内容を消して新しい文書を作成しますか？')) return;
    title.value = '無題のドキュメント';
    const first = createTab('タブ1');
    tabs = [first];
    activeTabId = first.id;
    editor.innerHTML = '';
    currentDirection = 'vertical';
    currentLatinOrientation = 'mixed';
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
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function allTabsSnapshot() {
    syncActiveTab();
    return tabs.map(tab => ({ ...tab }));
  }

  function documentHtml() {
    const vertical = currentDirection === 'vertical';
    const orientation = currentLatinOrientation === 'upright' ? 'upright' : 'mixed';
    const { width, height } = getPaperDimensions();
    const sections = allTabsSnapshot().map((tab, index) => (
      `<section class="export-tab${index ? ' page-break' : ''}" data-tab="${escapeHtml(tab.name)}">${tab.html || ''}</section>`
    )).join('');
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title.value)}</title><style>
@page{size:${width}mm ${height}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}
body{font-family:'Yu Mincho','Hiragino Mincho ProN',serif;font-size:12pt;line-height:2}
.export-tab{width:${width}mm;height:${height}mm;padding:18mm;box-sizing:border-box;overflow:hidden;${vertical ? `writing-mode:vertical-rl;text-orientation:${orientation};` : 'writing-mode:horizontal-tb;'}}
.page-break{break-before:page;page-break-before:always}
h1{font-size:20pt}h2{font-size:16pt}blockquote{border-inline-start:3px solid #999;padding-inline-start:.8em}
</style></head><body>${sections}</body></html>`;
  }

  function exportPdf() {
    $('exportDialog').close();
    printAllTabs();
  }

  function exportHtml() {
    downloadBlob(new Blob([documentHtml()], { type: 'text/html;charset=utf-8' }), `${safeFilename()}.html`);
  }

  function mmToPt(mm) {
    return Number((mm * 72 / 25.4).toFixed(3));
  }

  function plainTextFromHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return temp.innerText || temp.textContent || '';
  }

  function xmlEscape(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function buildStoryXml(storyId, html) {
    const text = plainTextFromHtml(html).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const paragraphs = text.split('\n');
    const body = paragraphs.map((line) => (
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[Basic Paragraph]"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[None]"><Content>${xmlEscape(line)}</Content><Br/></CharacterStyleRange></ParagraphStyleRange>`
    )).join('');
    const orientation = currentDirection === 'vertical' ? 'Vertical' : 'Horizontal';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><Story Self="${storyId}" UserText="true" TrackChanges="false" StoryTitle="${xmlEscape(title.value)}"><StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" StoryOrientation="${orientation}"/>${body}</Story></idPkg:Story>`;
  }

  function buildSpreadXml(spreadId, pageId, frameId, storyId, pageNumber, widthPt, heightPt) {
    const margin = mmToPt(18);
    const bottom = Math.max(margin, heightPt - margin);
    const right = Math.max(margin, widthPt - margin);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><Spread Self="${spreadId}" FlattenerOverride="Default" ShowMasterItems="true"><Page Self="${pageId}" GeometricBounds="0 0 ${heightPt} ${widthPt}" ItemTransform="1 0 0 1 0 0" Name="${pageNumber}" AppliedMaster="n"><Properties><PageColor type="enumeration">UseMasterColor</PageColor></Properties></Page><TextFrame Self="${frameId}" ParentStory="${storyId}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemLayer="ub0" GeometricBounds="${margin} ${margin} ${bottom} ${right}" ItemTransform="1 0 0 1 0 0"><TextFramePreference TextColumnCount="1" TextColumnGutter="12" TextColumnFixedWidth="0" UseFixedColumnWidth="false" FirstBaselineOffset="AscentOffset" MinimumFirstBaselineOffset="0" VerticalJustification="TopAlign" IgnoreWrap="false"/></TextFrame></Spread></idPkg:Spread>`;
  }

  function makeIdmlFiles() {
    const { width, height } = getPaperDimensions();
    const widthPt = mmToPt(width);
    const heightPt = mmToPt(height);
    const snapshots = allTabsSnapshot();
    const storyIds = snapshots.map((_, i) => `uStory${i + 1}`);
    const spreadIds = snapshots.map((_, i) => `uSpread${i + 1}`);
    const designImports = snapshots.map((_, i) => `<idPkg:Spread src="Spreads/Spread_${i + 1}.xml"/><idPkg:Story src="Stories/Story_${i + 1}.xml"/>`).join('');
    const designmap = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Document DOMVersion="18.0" Self="d" StoryList="${storyIds.join(' ')}" Name="${xmlEscape(title.value)}" ActiveLayer="ub0" xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/><idPkg:Graphic src="Resources/Graphic.xml"/><Layer Self="ub0" Name="レイヤー 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>${designImports}</Document>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><RootCharacterStyleGroup Self="uCharRoot"><CharacterStyle Self="CharacterStyle/$ID/[None]" Name="$ID/[None]"/></RootCharacterStyleGroup><RootParagraphStyleGroup Self="uParaRoot"><ParagraphStyle Self="ParagraphStyle/$ID/[No Paragraph Style]" Name="$ID/[No Paragraph Style]"/><ParagraphStyle Self="ParagraphStyle/$ID/[Basic Paragraph]" Name="$ID/[Basic Paragraph]" BasedOn="ParagraphStyle/$ID/[No Paragraph Style]" NextStyle="ParagraphStyle/$ID/[Basic Paragraph]" PointSize="12" Leading="24"/></RootParagraphStyleGroup></idPkg:Styles>`;
    const prefs = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Preferences xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><DocumentPreference Self="DocumentPreference" PageHeight="${heightPt}" PageWidth="${widthPt}" PagesPerDocument="${Math.max(1, snapshots.length)}" FacingPages="false" PageBinding="${currentDirection === 'vertical' ? 'RightToLeft' : 'LeftToRight'}"/></idPkg:Preferences>`;
    const fonts = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Fonts xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>`;
    const graphic = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>`;
    const container = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`;

    const files = [
      { name: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package' },
      { name: 'META-INF/container.xml', data: container },
      { name: 'designmap.xml', data: designmap },
      { name: 'Resources/Styles.xml', data: styles },
      { name: 'Resources/Preferences.xml', data: prefs },
      { name: 'Resources/Fonts.xml', data: fonts },
      { name: 'Resources/Graphic.xml', data: graphic }
    ];

    snapshots.forEach((tab, i) => {
      files.push({ name: `Stories/Story_${i + 1}.xml`, data: buildStoryXml(storyIds[i], tab.html) });
      files.push({ name: `Spreads/Spread_${i + 1}.xml`, data: buildSpreadXml(spreadIds[i], `uPage${i + 1}`, `uFrame${i + 1}`, storyIds[i], i + 1, widthPt, heightPt) });
    });
    return files;
  }

  function exportIdml() {
    try {
      const blob = createStoredZip(makeIdmlFiles());
      downloadBlob(blob, `${safeFilename()}.idml`);
    } catch (e) {
      console.error(e);
      alert('IDMLの生成に失敗しました。');
    }
  }

  function crc32(bytes) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
    return (crc ^ (-1)) >>> 0;
  }

  function u16(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255]);
  }

  function u32(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    parts.forEach((p) => { out.set(p, offset); offset += p.length; });
    return out;
  }

  function createStoredZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.data);
      const crc = crc32(data);
      const localHeader = concatBytes([
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name
      ]);
      const local = concatBytes([localHeader, data]);
      locals.push(local);
      const central = concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name
      ]);
      centrals.push(central);
      offset += local.length;
    });
    const centralBytes = concatBytes(centrals);
    const end = concatBytes([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralBytes.length), u32(offset), u16(0)
    ]);
    return new Blob([concatBytes([...locals, centralBytes, end])], { type: 'application/vnd.adobe.indesign-idml-package' });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  function printAllTabs() {
    const snapshots = allTabsSnapshot();
    const { width, height } = getPaperDimensions();
    const container = document.createElement('div');
    container.id = 'printExportContainer';
    container.style.display = 'none';
    snapshots.forEach((tab) => {
      const page = document.createElement('section');
      page.className = 'print-export-page';
      page.innerHTML = tab.html || '';
      container.appendChild(page);
    });
    document.body.appendChild(container);
    let style = document.getElementById('printExportStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'printExportStyle';
      document.head.appendChild(style);
    }
    const orientation = currentLatinOrientation === 'upright' ? 'upright' : 'mixed';
    style.textContent = `@page{size:${width}mm ${height}mm;margin:0}@media print{body>*:not(#printExportContainer){display:none!important}#printExportContainer{display:block!important}.print-export-page{width:${width}mm;height:${height}mm;padding:18mm;box-sizing:border-box;overflow:hidden;break-after:page;page-break-after:always;font-family:'Yu Mincho','Hiragino Mincho ProN',serif;font-size:12pt;line-height:2;${currentDirection === 'vertical' ? `writing-mode:vertical-rl;text-orientation:${orientation};` : 'writing-mode:horizontal-tb;'}}.print-export-page:last-child{break-after:auto;page-break-after:auto}}`;
    const cleanup = () => {
      container.remove();
      style.textContent = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 0);
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
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
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
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => { node.nodeValue = node.nodeValue.split(term).join(replacement); });
    $('findMessage').textContent = `${count}件置換しました。`;
    syncActiveTab();
    scheduleSave();
    updateCount();
  }

  function showMenu(button, key) {
    const defs = menuDefinitions[key] || [];
    menuPanel.innerHTML = '';
    defs.forEach(item => {
      if (item[0] === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        menuPanel.appendChild(sep);
        return;
      }
      const [label, shortcut, action] = item;
      const btn = document.createElement('button');
      btn.className = 'menu-item';
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

  editor.addEventListener('input', () => {
    const size = Number($('fontSizeInput').value || 12);
    normalizeCustomFontSizes(size);
    rememberEditorSelection();
    syncActiveTab();
    scheduleSave();
    updateCount();
  });
  editor.addEventListener('keyup', rememberEditorSelection);
  editor.addEventListener('mouseup', rememberEditorSelection);
  document.addEventListener('selectionchange', rememberEditorSelection);
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
  latinOrientationBtn.addEventListener('pointerdown', rememberEditorSelection);
  latinOrientationBtn.addEventListener('click', toggleLatinOrientation);
  $('addTabBtn').addEventListener('click', addTab);
  $('zoomSelect').addEventListener('change', (e) => setZoom(Number(e.target.value)));
  $('paperSizeSelect').addEventListener('change', (e) => setPaperSize(e.target.value));
  $('paperOrientationSelect').addEventListener('change', (e) => setPaperOrientation(e.target.value));
  $('blockSelect').addEventListener('change', (e) => formatBlock(e.target.value));
  $('fontSelect').addEventListener('change', (e) => cmd('fontName', e.target.value));
  $('fontSizeInput').addEventListener('pointerdown', rememberEditorSelection);
  $('fontSizeInput').addEventListener('change', (e) => applyFontSize(e.target.value));
  $('fontSizeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyFontSize(e.currentTarget.value); }
  });
  $('findNextBtn').addEventListener('click', findNext);
  $('replaceOneBtn').addEventListener('click', replaceOne);
  $('replaceAllBtn').addEventListener('click', replaceAll);
  $('closeFindBtn').addEventListener('click', () => $('findDialog').close());
  $('exportPdfBtn').addEventListener('click', exportPdf);
  $('exportHtmlBtn').addEventListener('click', exportHtml);
  $('exportIdmlBtn').addEventListener('click', exportIdml);
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
