/**
 * Shift Master - アプリケーション全体ロジック
 */

class ShiftMasterApp {
  constructor() {
    this.currentDate = new Date(); // カレンダー表示用
    this.selectedDates = new Set(); // 選択中日付 ("YYYY-MM-DD")
    this.activeTab = 'tab-request';  // 現在のタブ
    this.salaryMode = 'confirmed';   // 'confirmed' (確定シフト基準) or 'requested' (希望シフト試算)
    
    // ドラッグ選択用状態
    this.isDragging = false;
    this.dragStartDate = null;
    this.dragTargetDates = new Set();

    // データ読み込み
    this.loadSettings();
    this.loadTemplates();
    this.loadShifts();

    // イベントリスナーの登録
    this.initEventListeners();
    this.initPWA();

    // 初期描画
    this.renderCalendar();
    this.renderSalarySummary();
    this.renderTemplateChips();
    this.renderSettingsUI();
  }

  // ============================================================
  // 設定管理
  // ============================================================
  loadSettings() {
    const defaultSettings = {
      storeCode: '02006',
      empCode: '5155517',
      param: '02006|5155517',
      kgcd: '0001',
      regularWage: 1300,
      nightWage: 1625,
      makanaiDeduction: 320, // 賄い控除 320円
      workKind: '01'
    };

    const saved = localStorage.getItem('shift_master_settings');
    this.settings = saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    this.updateParam();
  }

  saveSettings() {
    this.updateParam();
    localStorage.setItem('shift_master_settings', JSON.stringify(this.settings));
    this.showToast('設定を保存しました');
    this.renderSettingsUI();
    this.renderSalarySummary();
  }

  updateParam() {
    this.settings.param = `${this.settings.storeCode || ''}|${this.settings.empCode || ''}`;
  }

  // ============================================================
  // テンプレート管理 (名称・時間・カラー変更・追加可能)
  // ============================================================
  loadTemplates() {
    const defaultTemplates = [
      { id: 'plan1', name: 'プラン1', start: '10:00', end: '17:00', color: '#1f7a4d' },
      { id: 'plan2', name: 'プラン2', start: '17:00', end: '22:00', color: '#195aa0' },
      { id: 'plan3', name: 'プラン3', start: '18:00', end: '23:00', color: '#673ab7' }
    ];

    const saved = localStorage.getItem('shift_master_templates');
    this.templates = saved ? JSON.parse(saved) : defaultTemplates;
  }

  saveTemplates() {
    localStorage.setItem('shift_master_templates', JSON.stringify(this.templates));
    this.renderTemplateChips();
    this.renderTemplateSettingsList();
  }

  renderTemplateChips() {
    const container = document.getElementById('template-chips-container');
    if (!container) return;

    container.innerHTML = '';
    this.templates.forEach(tpl => {
      const btn = document.createElement('button');
      btn.className = 'chip-btn';
      btn.innerHTML = `
        <span class="chip-color-dot" style="background-color: ${tpl.color};"></span>
        <span>${tpl.name} (${tpl.start.replace(':00','')}-${tpl.end.replace(':00','')})</span>
      `;
      btn.addEventListener('click', () => {
        this.applyTemplate(tpl.id);
      });
      container.appendChild(btn);
    });

    // 「＋プラン追加」ボタン
    const addBtn = document.createElement('button');
    addBtn.className = 'chip-add-btn';
    addBtn.innerHTML = '<span>＋ プラン追加</span>';
    addBtn.addEventListener('click', () => {
      this.openTemplateEditModal(null);
    });
    container.appendChild(addBtn);
  }

  openTemplateEditModal(templateId) {
    const modal = document.getElementById('template-edit-modal');
    const title = document.getElementById('template-modal-title');
    const deleteBtn = document.getElementById('btn-delete-template');

    if (templateId) {
      const tpl = this.templates.find(t => t.id === templateId);
      if (!tpl) return;
      this.editingTemplateId = templateId;
      title.textContent = 'プラン編集';
      document.getElementById('template-name-input').value = tpl.name;
      document.getElementById('template-start-time').value = tpl.start;
      document.getElementById('template-end-time').value = tpl.end;
      document.getElementById('template-color-input').value = tpl.color || '#1f7a4d';
      deleteBtn.style.display = 'block';
    } else {
      this.editingTemplateId = null;
      title.textContent = '新規プラン追加';
      document.getElementById('template-name-input').value = `プラン${this.templates.length + 1}`;
      document.getElementById('template-start-time').value = '17:00';
      document.getElementById('template-end-time').value = '22:00';
      document.getElementById('template-color-input').value = '#c68f23';
      deleteBtn.style.display = 'none';
    }

    modal.classList.add('show');
  }

  closeTemplateEditModal() {
    document.getElementById('template-edit-modal').classList.remove('show');
    this.editingTemplateId = null;
  }

  saveTemplateFromModal() {
    const name = document.getElementById('template-name-input').value.trim() || '無題プラン';
    const start = document.getElementById('template-start-time').value;
    const end = document.getElementById('template-end-time').value;
    const color = document.getElementById('template-color-input').value;

    if (this.editingTemplateId) {
      const tpl = this.templates.find(t => t.id === this.editingTemplateId);
      if (tpl) {
        tpl.name = name;
        tpl.start = start;
        tpl.end = end;
        tpl.color = color;
      }
    } else {
      const newId = 'plan_' + Date.now();
      this.templates.push({ id: newId, name, start, end, color });
    }

    this.saveTemplates();
    this.closeTemplateEditModal();
    this.showToast('プランを保存しました');
  }

  deleteTemplateFromModal() {
    if (!this.editingTemplateId) return;
    this.templates = this.templates.filter(t => t.id !== this.editingTemplateId);
    this.saveTemplates();
    this.closeTemplateEditModal();
    this.showToast('プランを削除しました');
  }

  // ============================================================
  // シフトデータ管理 (LocalStorage)
  // ============================================================
  loadShifts() {
    const savedReq = localStorage.getItem('shift_master_requested');
    this.requestedShifts = savedReq ? JSON.parse(savedReq) : {};

    const savedConf = localStorage.getItem('shift_master_confirmed');
    this.confirmedShifts = savedConf ? JSON.parse(savedConf) : {};
  }

  saveRequestedShifts() {
    localStorage.setItem('shift_master_requested', JSON.stringify(this.requestedShifts));
    this.renderCalendar();
    this.renderSalarySummary();
  }

  saveConfirmedShifts() {
    localStorage.setItem('shift_master_confirmed', JSON.stringify(this.confirmedShifts));
    this.renderCalendar();
    this.renderSalarySummary();
  }

  // ============================================================
  // 新・給与計算ロジック
  // - 休憩時間: 拘束時間 ≤6h: 20分, 6〜8h: 45分, >8h: 60分
  // - 賄い控除: 1勤務あたり320円控除
  // - 残業手当: 実働8時間超え分は時給25%増 (通常時給×1.25)
  // - 深夜時間帯: 22:00〜翌5:00 (通常時給×1.25)
  // ============================================================
  calculateDaySalary(shift) {
    if (!shift || !shift.start || !shift.end) {
      return {
        regularHours: 0,
        nightHours: 0,
        overtimeHours: 0,
        totalWorkHours: 0,
        breakMinutes: 0,
        regularPay: 0,
        nightPay: 0,
        overtimePay: 0,
        makanaiDeduction: 0,
        totalPay: 0
      };
    }

    const [stH, stM] = shift.start.split(':').map(Number);
    const [edH, edM] = shift.end.split(':').map(Number);

    let startMinutes = stH * 60 + stM;
    let endMinutes = edH * 60 + edM;

    // 翌日にまたがる場合
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }

    const totalSpanMinutes = endMinutes - startMinutes; // 拘束時間

    // 【要件】休憩時間ルール
    let breakMinutes = 0;
    if (totalSpanMinutes <= 6 * 60) {
      breakMinutes = 20; // 6時間以内なら20分
    } else if (totalSpanMinutes <= 8 * 60) {
      breakMinutes = 45; // 6〜8時間なら45分
    } else {
      breakMinutes = 60; // 8時間以上なら1時間
    }

    // 1分刻みで精密積算
    let rawRegMin = 0;
    let rawNightMin = 0;

    for (let m = startMinutes; m < endMinutes; m++) {
      const normalizedM = m % (24 * 60);
      // 深夜判定: 22:00 (1320) 〜 翌05:00 (300)
      if (normalizedM >= 1320 || normalizedM < 300) {
        rawNightMin++;
      } else {
        rawRegMin++;
      }
    }

    // 休憩時間は通常勤務から優先控除
    let netRegMin = rawRegMin;
    let netNightMin = rawNightMin;

    if (netRegMin >= breakMinutes) {
      netRegMin -= breakMinutes;
    } else {
      const remainBreak = breakMinutes - netRegMin;
      netRegMin = 0;
      netNightMin = Math.max(0, netNightMin - remainBreak);
    }

    const totalWorkMinutes = netRegMin + netNightMin;
    const totalWorkHours = totalWorkMinutes / 60;

    // 【要件】残業判定（実働8時間超え分）
    const overtimeMinutes = Math.max(0, totalWorkMinutes - 8 * 60);
    const overtimeHours = overtimeMinutes / 60;

    const regularRate = Number(this.settings.regularWage) || 1300;
    const nightRate = Number(this.settings.nightWage) || 1625;
    const overtimeExtraRate = regularRate * 0.25; // 残業手当割増分（時給25%増）

    // 基本通常給与 + 深夜給与
    const regularHours = netRegMin / 60;
    const nightHours = netNightMin / 60;

    const regularPay = Math.round(regularHours * regularRate);
    const nightPay = Math.round(nightHours * nightRate);

    // 残業割増手当（8時間超え分に時給25%追加）
    const overtimePay = Math.round(overtimeHours * overtimeExtraRate);

    // 【要件】賄い控除（1勤務あたり320円）
    const makanaiDeduction = Number(this.settings.makanaiDeduction) || 320;

    // 総給与（手当加算、賄い控除）
    const grossPay = regularPay + nightPay + overtimePay;
    const totalPay = Math.max(0, grossPay - makanaiDeduction);

    return {
      regularHours: Number(regularHours.toFixed(2)),
      nightHours: Number(nightHours.toFixed(2)),
      overtimeHours: Number(overtimeHours.toFixed(2)),
      totalWorkHours: Number(totalWorkHours.toFixed(2)),
      breakMinutes,
      regularPay,
      nightPay,
      overtimePay,
      makanaiDeduction,
      totalPay
    };
  }

  // ============================================================
  // カレンダー描画 & ドラッグ範囲選択
  // ============================================================
  renderCalendar() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const monthLabel = document.getElementById('current-month-label');
    if (monthLabel) {
      monthLabel.textContent = `${year}年 ${month + 1}月`;
    }

    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const oldDays = grid.querySelectorAll('.calendar-day');
    oldDays.forEach(d => d.remove());

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    // 前月
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const dateStr = this.formatDate(prevDate);
      grid.appendChild(this.createDayCell(dayNum, dateStr, true));
    }

    // 当月
    const todayStr = this.formatDate(new Date());
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const curDate = new Date(year, month, d);
      const dateStr = this.formatDate(curDate);
      const isToday = (dateStr === todayStr);
      grid.appendChild(this.createDayCell(d, dateStr, false, isToday));
    }

    // 次月
    const totalCells = startDayOfWeek + lastDay.getDate();
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const dateStr = this.formatDate(nextDate);
      grid.appendChild(this.createDayCell(d, dateStr, true));
    }

    this.updateSelectionInfo();
  }

  createDayCell(dayNum, dateStr, isOtherMonth, isToday = false) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.dataset.date = dateStr;

    if (isOtherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');
    if (this.selectedDates.has(dateStr)) cell.classList.add('selected');

    const dayOfWeek = new Date(dateStr).getDay();
    if (dayOfWeek === 6) cell.classList.add('sat');
    if (dayOfWeek === 0) cell.classList.add('sun');

    const dayHeader = document.createElement('div');
    dayHeader.className = 'day-header';
    const numSpan = document.createElement('span');
    numSpan.className = 'day-num';
    numSpan.textContent = dayNum;
    dayHeader.appendChild(numSpan);
    cell.appendChild(dayHeader);

    // シフトデータ表示
    // 希望シフト画面では希望シフト、確定画面では確定シフトを表示
    const targetSource = (this.activeTab === 'tab-confirmed') ? this.confirmedShifts : this.requestedShifts;
    const shift = targetSource[dateStr];

    if (shift && shift.start && shift.end) {
      const tag = document.createElement('div');
      tag.className = 'shift-tag';

      // 該当するテンプレートを検索
      const matchedTpl = this.templates.find(t => t.start === shift.start && t.end === shift.end);
      if (matchedTpl) {
        tag.textContent = matchedTpl.name;
        tag.style.backgroundColor = matchedTpl.color;
      } else {
        tag.textContent = '勤務';
        tag.style.backgroundColor = '#1b2a4a';
      }
      cell.appendChild(tag);

      const timeSub = document.createElement('div');
      timeSub.className = 'shift-time-sub';
      timeSub.textContent = `${shift.start.replace(':00','')}-${shift.end.replace(':00','')}`;
      cell.appendChild(timeSub);
    }

    // マウスドラッグ操作（範囲選択）
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.dragStartDate = dateStr;
      this.dragTargetDates = new Set([dateStr]);
      this.highlightDragRange(dateStr, dateStr);
    });

    cell.addEventListener('mouseenter', () => {
      if (this.isDragging && this.dragStartDate) {
        this.highlightDragRange(this.dragStartDate, dateStr);
      }
    });

    // タッチ操作（スマホでのドラッグ範囲選択対応）
    cell.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      this.dragStartDate = dateStr;
      this.dragTargetDates = new Set([dateStr]);
      this.highlightDragRange(dateStr, dateStr);
    }, { passive: true });

    cell.addEventListener('touchmove', (e) => {
      if (!this.isDragging || !this.dragStartDate) return;
      const touch = e.touches[0];
      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
      const dayElement = targetElement?.closest('.calendar-day');
      if (dayElement && dayElement.dataset.date) {
        this.highlightDragRange(this.dragStartDate, dayElement.dataset.date);
      }
    }, { passive: true });

    // クリック（単一選択/モーダル）
    cell.addEventListener('click', (e) => {
      if (!this.dragTriggered) {
        this.handleCellSingleClick(dateStr);
      }
    });

    return cell;
  }

  // ドラッグ範囲の計算とハイライト
  highlightDragRange(startStr, endStr) {
    this.dragTriggered = true;
    const start = new Date(startStr);
    const end = new Date(endStr);
    const minDate = start <= end ? start : end;
    const maxDate = start <= end ? end : start;

    this.dragTargetDates.clear();
    const cur = new Date(minDate);
    while (cur <= maxDate) {
      this.dragTargetDates.add(this.formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    // カレンダーセルをハイライト
    document.querySelectorAll('.calendar-day').forEach(el => {
      const d = el.dataset.date;
      if (this.dragTargetDates.has(d)) {
        el.classList.add('drag-selecting');
      } else {
        el.classList.remove('drag-selecting');
      }
    });
  }

  finishDragSelection() {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (this.dragTargetDates.size > 0) {
      // ドラッグした範囲を選択リストに追加
      this.dragTargetDates.forEach(d => this.selectedDates.add(d));
      this.dragTargetDates.clear();
      this.renderCalendar();
    }

    setTimeout(() => {
      this.dragTriggered = false;
    }, 100);
  }

  handleCellSingleClick(dateStr) {
    if (this.selectedDates.has(dateStr)) {
      this.selectedDates.delete(dateStr);
    } else {
      this.selectedDates.add(dateStr);
    }
    this.renderCalendar();
  }

  updateSelectionInfo() {
    const badge = document.getElementById('selected-count-badge');
    const clearBtn = document.getElementById('btn-clear-selection');
    if (badge) {
      badge.textContent = `${this.selectedDates.size}日選択中`;
      badge.style.display = this.selectedDates.size > 0 ? 'inline-block' : 'none';
    }
    if (clearBtn) {
      clearBtn.style.display = this.selectedDates.size > 0 ? 'inline-block' : 'none';
    }
  }

  clearSelection() {
    this.selectedDates.clear();
    this.renderCalendar();
  }

  // ============================================================
  // 定型テンプレート適用
  // ============================================================
  applyTemplate(templateId) {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) return;

    if (this.selectedDates.size === 0) {
      this.showToast('カレンダーの日付をタップまたはドラッグして選択してください');
      return;
    }

    const targetStore = (this.activeTab === 'tab-confirmed') ? this.confirmedShifts : this.requestedShifts;

    this.selectedDates.forEach(dateStr => {
      targetStore[dateStr] = {
        type: '01|0',
        start: tpl.start,
        end: tpl.end,
        memo: ''
      };
    });

    if (this.activeTab === 'tab-confirmed') {
      this.saveConfirmedShifts();
    } else {
      this.saveRequestedShifts();
    }

    this.showToast(`${this.selectedDates.size}日間に「${tpl.name}」を一括登録しました`);
    this.selectedDates.clear();
    this.renderCalendar();
  }

  // ============================================================
  // FoodIT 連携ダイアログ (選択した日だけを一括登録)
  // ============================================================
  openFoodITSubmitModal() {
    if (this.selectedDates.size === 0) {
      this.showToast('カレンダーで申請したい日付を選択してください');
      return;
    }

    const modal = document.getElementById('foodit-modal');
    const listContainer = document.getElementById('foodit-shift-list');
    listContainer.innerHTML = '';

    // 選択された日付の中で希望シフトが存在するものを抽出
    const targets = Array.from(this.selectedDates)
      .sort()
      .map(dateStr => ({ dateStr, shift: this.requestedShifts[dateStr] }))
      .filter(item => item.shift && item.shift.start && item.shift.end);

    if (targets.length === 0) {
      listContainer.innerHTML = `<p style="text-align:center;color:var(--c-text-muted);padding:20px;">選択した日付に希望シフトが入力されていません。</p>`;
      document.getElementById('btn-foodit-submit-all').style.display = 'none';
    } else {
      document.getElementById('btn-foodit-submit-all').style.display = 'flex';
      targets.forEach(({ dateStr, shift }) => {
        const item = document.createElement('div');
        item.className = 'confirmed-item';
        item.innerHTML = `
          <div>
            <div class="confirmed-date">${dateStr}</div>
            <div class="confirmed-time">${shift.start}〜${shift.end}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="header-btn" style="background:var(--c-primary);color:#fff;" onclick="window.app.submitSingleFoodIT('${dateStr}')">送信</button>
            <button class="header-btn" style="background:#f1f5f9;color:var(--c-primary);" onclick="window.app.showCurl('${dateStr}')">cURL</button>
          </div>
        `;
        listContainer.appendChild(item);
      });
    }

    modal.classList.add('show');
  }

  closeFoodITModal() {
    document.getElementById('foodit-modal').classList.remove('show');
  }

  submitSingleFoodIT(dateStr) {
    const shift = this.requestedShifts[dateStr];
    if (!shift) return;

    if (!this.settings.storeCode || !this.settings.empCode) {
      this.showToast('設定画面で店舗番号と社員番号を設定してください');
      return;
    }

    window.FoodIT.submitDirectForm(dateStr, shift, this.settings, true);
    this.showToast(`${dateStr} を送信しました`);
  }

  submitSelectedFoodIT() {
    const targets = Array.from(this.selectedDates)
      .sort()
      .map(dateStr => ({ dateStr, shift: this.requestedShifts[dateStr] }))
      .filter(item => item.shift && item.shift.start && item.shift.end);

    if (targets.length === 0) return;

    let idx = 0;
    const sendNext = () => {
      if (idx >= targets.length) {
        this.showToast('選択したシフトの申請が完了しました！');
        this.closeFoodITModal();
        return;
      }
      const { dateStr, shift } = targets[idx];
      window.FoodIT.submitDirectForm(dateStr, shift, this.settings, true);
      idx++;
      if (idx < targets.length) {
        setTimeout(sendNext, 800);
      }
    };

    if (confirm(`選択した${targets.length}日分のシフトを申請しますか？`)) {
      sendNext();
    }
  }

  showCurl(dateStr) {
    const shift = this.requestedShifts[dateStr];
    if (!shift) return;
    const cmd = window.FoodIT.generateCurlCommand(dateStr, shift, this.settings);
    navigator.clipboard.writeText(cmd).then(() => {
      this.showToast('cURLコマンドをコピーしました');
    }).catch(() => {
      prompt('cURLコマンド:', cmd);
    });
  }

  // ============================================================
  // 給与計算画面 (希望シフト試算 / 確定シフト計算 切替対応)
  // ============================================================
  renderSalarySummary() {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    const targetShifts = (this.salaryMode === 'requested') ? this.requestedShifts : this.confirmedShifts;

    let totalRegHours = 0;
    let totalNightHours = 0;
    let totalOvertimeHours = 0;
    let totalRegPay = 0;
    let totalNightPay = 0;
    let totalOvertimePay = 0;
    let totalMakanaiCount = 0;

    const listContainer = document.getElementById('salary-shift-list');
    if (listContainer) listContainer.innerHTML = '';

    const monthShifts = Object.entries(targetShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix))
      .sort((a, b) => a[0].localeCompare(b[0]));

    monthShifts.forEach(([dateStr, shift]) => {
      if (!shift || !shift.start || !shift.end) return;

      const calc = this.calculateDaySalary(shift);
      totalRegHours += calc.regularHours;
      totalNightHours += calc.nightHours;
      totalOvertimeHours += calc.overtimeHours;
      totalRegPay += calc.regularPay;
      totalNightPay += calc.nightPay;
      totalOvertimePay += calc.overtimePay;
      totalMakanaiCount++;

      if (listContainer) {
        const item = document.createElement('div');
        item.className = 'confirmed-item';
        item.innerHTML = `
          <div>
            <div class="confirmed-date">${dateStr}</div>
            <div class="confirmed-time">${shift.start}〜${shift.end} (休:${calc.breakMinutes}分)</div>
          </div>
          <div class="confirmed-pay">
            <div class="confirmed-pay-val">¥${calc.totalPay.toLocaleString()}</div>
            <div class="confirmed-pay-hours">実働${calc.totalWorkHours}h (残業:${calc.overtimeHours}h 賄い:-¥${calc.makanaiDeduction})</div>
          </div>
        `;
        listContainer.appendChild(item);
      }
    });

    const totalWorkHours = totalRegHours + totalNightHours;
    const totalMakanaiDeduction = totalMakanaiCount * (Number(this.settings.makanaiDeduction) || 320);
    const grossTotal = totalRegPay + totalNightPay + totalOvertimePay;
    const finalTotalPay = Math.max(0, grossTotal - totalMakanaiDeduction);

    // DOMへの反映
    const sumTotalPay = document.getElementById('summary-total-pay');
    if (sumTotalPay) sumTotalPay.textContent = `¥${finalTotalPay.toLocaleString()}`;

    const sumTotalHours = document.getElementById('summary-total-hours');
    if (sumTotalHours) sumTotalHours.textContent = `${totalWorkHours.toFixed(1)} 時間`;

    const sumRegPay = document.getElementById('summary-regular-pay');
    if (sumRegPay) sumRegPay.textContent = `¥${totalRegPay.toLocaleString()}`;
    const sumRegHours = document.getElementById('summary-regular-hours');
    if (sumRegHours) sumRegHours.textContent = `${totalRegHours.toFixed(1)}h`;

    const sumNightPay = document.getElementById('summary-night-pay');
    if (sumNightPay) sumNightPay.textContent = `¥${totalNightPay.toLocaleString()}`;
    const sumNightHours = document.getElementById('summary-night-hours');
    if (sumNightHours) sumNightHours.textContent = `${totalNightHours.toFixed(1)}h`;

    const sumOvertimePay = document.getElementById('summary-overtime-pay');
    if (sumOvertimePay) sumOvertimePay.textContent = `¥${totalOvertimePay.toLocaleString()}`;
    const sumOvertimeHours = document.getElementById('summary-overtime-hours');
    if (sumOvertimeHours) sumOvertimeHours.textContent = `${totalOvertimeHours.toFixed(1)}h`;

    const sumMakanaiPay = document.getElementById('summary-makanai-deduction');
    if (sumMakanaiPay) sumMakanaiPay.textContent = `-¥${totalMakanaiDeduction.toLocaleString()}`;
    const sumMakanaiCount = document.getElementById('summary-makanai-count');
    if (sumMakanaiCount) sumMakanaiCount.textContent = `${totalMakanaiCount}回`;

    const salaryPeriod = document.getElementById('salary-period-label');
    if (salaryPeriod) {
      const modeLabel = this.salaryMode === 'requested' ? '【希望試算】' : '【確定給与】';
      salaryPeriod.textContent = `${modeLabel} ${year}年 ${Number(month)}月度`;
    }
  }

  setSalaryMode(mode) {
    this.salaryMode = mode;
    document.querySelectorAll('.salary-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    this.renderSalarySummary();
  }

  importRequestedToConfirmed() {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    const monthReq = Object.entries(this.requestedShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix) && this.requestedShifts[dateStr]?.start);

    if (monthReq.length === 0) {
      this.showToast('反映可能な希望シフトがありません');
      return;
    }

    if (!confirm(`${year}年${Number(month)}月の希望シフト(${monthReq.length}件)を確定シフトに反映しますか？`)) {
      return;
    }

    monthReq.forEach(([dateStr, shift]) => {
      this.confirmedShifts[dateStr] = { ...shift };
    });

    this.saveConfirmedShifts();
    this.showToast('確定シフトへ反映しました');
  }

  // ============================================================
  // 設定画面
  // ============================================================
  renderSettingsUI() {
    const storeInput = document.getElementById('setting-store-code');
    const empInput = document.getElementById('setting-emp-code');
    const paramPreview = document.getElementById('setting-param-preview');
    const regWageInput = document.getElementById('setting-regular-wage');
    const nightWageInput = document.getElementById('setting-night-wage');
    const makanaiInput = document.getElementById('setting-makanai');

    if (storeInput) storeInput.value = this.settings.storeCode || '';
    if (empInput) empInput.value = this.settings.empCode || '';
    if (paramPreview) paramPreview.textContent = `Param=${this.settings.param || ''}`;
    if (regWageInput) regWageInput.value = this.settings.regularWage || 1300;
    if (nightWageInput) nightWageInput.value = this.settings.nightWage || 1625;
    if (makanaiInput) makanaiInput.value = this.settings.makanaiDeduction || 320;

    this.renderTemplateSettingsList();
  }

  renderTemplateSettingsList() {
    const list = document.getElementById('template-manage-list');
    if (!list) return;

    list.innerHTML = '';
    this.templates.forEach(tpl => {
      const item = document.createElement('div');
      item.className = 'template-manage-item';
      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="chip-color-dot" style="background-color:${tpl.color};"></span>
          <strong>${tpl.name}</strong>
          <span style="font-size:0.75rem;color:var(--c-text-muted);">${tpl.start}〜${tpl.end}</span>
        </div>
        <button class="header-btn" style="background:var(--c-primary);color:#fff;" onclick="window.app.openTemplateEditModal('${tpl.id}')">編集</button>
      `;
      list.appendChild(item);
    });
  }

  // ============================================================
  // UIイベント & ナビゲーション初期化
  // ============================================================
  initEventListeners() {
    // タブ切り替え
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tabTarget = item.getAttribute('data-tab');
        this.switchTab(tabTarget);
      });
    });

    // カレンダー前月・次月・今日
    document.getElementById('prev-month-btn')?.addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.selectedDates.clear();
      this.renderCalendar();
      this.renderSalarySummary();
    });

    document.getElementById('next-month-btn')?.addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.selectedDates.clear();
      this.renderCalendar();
      this.renderSalarySummary();
    });

    document.getElementById('today-btn')?.addEventListener('click', () => {
      this.currentDate = new Date();
      this.selectedDates.clear();
      this.renderCalendar();
      this.renderSalarySummary();
    });

    // 選択クリアボタン
    document.getElementById('btn-clear-selection')?.addEventListener('click', () => {
      this.clearSelection();
    });

    // ドラッグ選択終了イベント
    window.addEventListener('mouseup', () => {
      this.finishDragSelection();
    });
    window.addEventListener('touchend', () => {
      this.finishDragSelection();
    });

    // 「シフト希望申請」ボタン
    document.getElementById('btn-open-shift-apply')?.addEventListener('click', () => {
      this.openFoodITSubmitModal();
    });

    document.getElementById('btn-close-foodit')?.addEventListener('click', () => {
      this.closeFoodITModal();
    });

    document.getElementById('btn-foodit-submit-all')?.addEventListener('click', () => {
      this.submitSelectedFoodIT();
    });

    // テンプレート編集モーダル
    document.getElementById('btn-close-template-modal')?.addEventListener('click', () => {
      this.closeTemplateEditModal();
    });
    document.getElementById('btn-save-template')?.addEventListener('click', () => {
      this.saveTemplateFromModal();
    });
    document.getElementById('btn-delete-template')?.addEventListener('click', () => {
      this.deleteTemplateFromModal();
    });

    // 給与計算モード切替
    document.querySelectorAll('.salary-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setSalaryMode(btn.dataset.mode);
      });
    });

    // 確定シフトへの反映
    document.getElementById('btn-import-requested')?.addEventListener('click', () => {
      this.importRequestedToConfirmed();
    });

    // 設定保存
    const onSettingChange = () => {
      this.settings.storeCode = document.getElementById('setting-store-code').value.trim();
      this.settings.empCode = document.getElementById('setting-emp-code').value.trim();
      this.settings.regularWage = Number(document.getElementById('setting-regular-wage').value) || 1300;
      this.settings.nightWage = Number(document.getElementById('setting-night-wage').value) || 1625;
      this.settings.makanaiDeduction = Number(document.getElementById('setting-makanai').value) || 320;
      this.updateParam();
      document.getElementById('setting-param-preview').textContent = `Param=${this.settings.param}`;
    };

    ['setting-store-code', 'setting-emp-code', 'setting-regular-wage', 'setting-night-wage', 'setting-makanai'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', onSettingChange);
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      onSettingChange();
      this.saveSettings();
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

    const targetPane = document.getElementById(tabId);
    const targetNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);

    if (targetPane) targetPane.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    // タブ切り替え時にカレンダー表示を更新
    this.selectedDates.clear();
    this.renderCalendar();
    this.renderSalarySummary();
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
          console.warn('SW registration failed:', err);
        });
      });
    }
  }
}

// アプリ起動
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ShiftMasterApp();
});
