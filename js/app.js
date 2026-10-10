/**
 * Shift Master - アプリケーション全体ロジック
 */

class ShiftMasterApp {
  constructor() {
    this.currentDate = new Date(); // カレンダー表示用
    this.selectedDates = new Set(); // 選択中日付 ("YYYY-MM-DD")
    this.activeTab = 'tab-request';  // 現在のタブ
    this.salaryMode = 'confirmed';   // 'confirmed' (確定シフト基準) or 'requested' (希望シフト試算)
    
    // 一括選択トグル状態 (true: 複数日一括選択, false: 各日個別入力)
    this.isBatchMode = true;

    // ドラッグ選択用状態
    this.isPointerDown = false;
    this.isTouchMode = false;
    this.hasMovedRange = false;
    this.dragStartDate = null;
    this.dragStartWasSelected = false; // ドラッグ開始セルが選択済みだったか（範囲解除用）
    this.dragTargetDates = new Set();

    // 個別シフト編集状態
    this.editingSingleDate = null;
    this.editingSingleTarget = 'requested'; // 'requested' or 'confirmed'
    this.pendingSubmitTargets = [];

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
      workKind: '01',
      calendarEventTitle: 'れい　バイト'
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

    // 「🗑️ プラン削除」ボタン
    const delBtn = document.createElement('button');
    delBtn.className = 'chip-delete-btn';
    delBtn.innerHTML = '<span>🗑️ プラン削除</span>';
    delBtn.title = '選択した日のプランを削除します';
    delBtn.addEventListener('click', () => {
      this.deleteSelectedShifts();
    });
    container.appendChild(delBtn);

    this.renderSingleTemplateShortcuts();
  }

  renderSingleTemplateShortcuts() {
    const container = document.getElementById('single-template-shortcuts');
    if (!container) return;
    container.innerHTML = '';
    this.templates.forEach(tpl => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.innerHTML = `
        <span class="chip-color-dot" style="background-color: ${tpl.color};"></span>
        <span>${tpl.name} (${tpl.start.replace(':00','')}-${tpl.end.replace(':00','')})</span>
      `;
      btn.addEventListener('click', () => {
        const startInput = document.getElementById('single-shift-start');
        const endInput = document.getElementById('single-shift-end');
        const nameInput = document.getElementById('single-shift-name');
        const typeSelect = document.getElementById('single-shift-type');
        if (startInput) startInput.value = tpl.start;
        if (endInput) endInput.value = tpl.end;
        if (nameInput) nameInput.value = tpl.name;
        if (typeSelect) typeSelect.value = '01|0';
      });
      container.appendChild(btn);
    });
  }

  deleteSelectedShifts() {
    if (this.selectedDates.size === 0) {
      this.showToast('削除したい日付を選択してください');
      return;
    }

    const isConfirmed = (this.activeTab === 'tab-confirmed');
    const targetStore = isConfirmed ? this.confirmedShifts : this.requestedShifts;
    const targetName = isConfirmed ? '確定シフト' : '希望シフト';
    let count = 0;
    this.selectedDates.forEach(dateStr => {
      if (targetStore[dateStr]) {
        delete targetStore[dateStr];
        count++;
      }
    });

    if (count > 0) {
      if (isConfirmed) {
        this.saveConfirmedShifts();
      } else {
        this.saveRequestedShifts();
      }
      this.showToast(`${count}日分の${targetName}を削除しました`);
    } else {
      this.showToast('選択した日付にシフトはありませんでした');
    }

    this.selectedDates.clear();
    this.renderCalendar();
    this.renderSalarySummary();
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

    // 日曜日始まり: getDay() は 0(日) 〜 6(土)
    const startDayOfWeek = firstDay.getDay();

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
    const targetSource = (this.activeTab === 'tab-confirmed') ? this.confirmedShifts : this.requestedShifts;
    const shift = targetSource[dateStr];

    if (shift && shift.start && shift.end) {
      const tag = document.createElement('div');
      tag.className = 'shift-tag';

      const matchedTpl = this.templates.find(t => t.start === shift.start && t.end === shift.end);
      if (shift.type === '03|1') {
        tag.textContent = '有給';
        tag.style.backgroundColor = '#ea580c';
      } else if (shift.name) {
        tag.textContent = shift.name;
        tag.style.backgroundColor = matchedTpl ? matchedTpl.color : '#1b2a4a';
      } else if (matchedTpl) {
        tag.textContent = matchedTpl.name;
        tag.style.backgroundColor = matchedTpl.color;
      } else {
        tag.textContent = shift.memo || '勤務';
        tag.style.backgroundColor = '#1b2a4a';
      }
      cell.appendChild(tag);

      const timeSub = document.createElement('div');
      timeSub.className = 'shift-time-sub';
      timeSub.textContent = (shift.type === '03|1') 
        ? '有休' 
        : `${shift.start.replace(':00','')}-${shift.end.replace(':00','')}`;
      cell.appendChild(timeSub);
    }

    // マウスドラッグ操作（一括選択モード中のみ）
    cell.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!this.isBatchMode) {
        return;
      }
      this.isPointerDown = true;
      this.isTouchMode = false;
      this.hasMovedRange = false;
      this.dragStartDate = dateStr;
      this.dragStartWasSelected = this.selectedDates.has(dateStr);
      this.dragTargetDates = new Set([dateStr]);
    });

    cell.addEventListener('mouseenter', () => {
      if (this.isPointerDown && this.dragStartDate) {
        if (dateStr !== this.dragStartDate) {
          this.hasMovedRange = true;
          this.highlightDragRange(this.dragStartDate, dateStr);
        }
      }
    });

    // タッチ操作（スマホでのドラッグ範囲選択対応）
    cell.addEventListener('touchstart', (e) => {
      if (!this.isBatchMode) {
        return;
      }
      this.isPointerDown = true;
      this.isTouchMode = true;
      this.hasMovedRange = false;
      this.dragStartDate = dateStr;
      this.dragStartWasSelected = this.selectedDates.has(dateStr);
      this.dragTargetDates = new Set([dateStr]);
    }, { passive: true });

    cell.addEventListener('touchmove', (e) => {
      if (!this.isPointerDown || !this.dragStartDate) return;
      const touch = e.touches[0];
      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
      const dayElement = targetElement?.closest('.calendar-day');
      if (dayElement && dayElement.dataset.date) {
        const hoverDate = dayElement.dataset.date;
        if (hoverDate !== this.dragStartDate) {
          this.hasMovedRange = true;
          this.highlightDragRange(this.dragStartDate, hoverDate);
        }
      }
    }, { passive: true });

    // クリック（PCマウスクリック時の動作）
    cell.addEventListener('click', (e) => {
      if (this.hasMovedRange || this.justTouched) return;
      this.handleCellAction(dateStr);
    });

    return cell;
  }

  // ドラッグ範囲の計算とハイライト
  highlightDragRange(startStr, endStr) {
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

    // カレンダーセルをハイライト（追加または解除）
    document.querySelectorAll('.calendar-day').forEach(el => {
      const d = el.dataset.date;
      if (this.dragTargetDates.has(d)) {
        if (this.dragStartWasSelected) {
          el.classList.add('drag-deselecting');
          el.classList.remove('drag-selecting');
        } else {
          el.classList.add('drag-selecting');
          el.classList.remove('drag-deselecting');
        }
      } else {
        el.classList.remove('drag-selecting', 'drag-deselecting');
      }
    });
  }

  finishDragSelection() {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // 別のセルまでドラッグして範囲選択した場合
    if (this.hasMovedRange && this.dragTargetDates.size > 0) {
      if (this.dragStartWasSelected) {
        // ★要件5: 選択している日付を再度範囲選択した時は選択を解除！
        this.dragTargetDates.forEach(d => this.selectedDates.delete(d));
      } else {
        // 未選択の日付から範囲選択した時は選択を追加！
        this.dragTargetDates.forEach(d => this.selectedDates.add(d));
      }
      this.dragTargetDates.clear();
      document.querySelectorAll('.calendar-day').forEach(el => {
        el.classList.remove('drag-selecting', 'drag-deselecting');
      });
      this.renderCalendar();
      setTimeout(() => {
        this.hasMovedRange = false;
      }, 50);
    } else {
      // 単一タップ（別セルへ移動していない）の場合
      document.querySelectorAll('.calendar-day').forEach(el => {
        el.classList.remove('drag-selecting', 'drag-deselecting');
      });
      this.dragTargetDates.clear();

      if (this.isTouchMode && this.dragStartDate) {
        this.handleCellAction(this.dragStartDate);
        this.justTouched = true;
        setTimeout(() => {
          this.justTouched = false;
        }, 300);
      }
    }
    this.isTouchMode = false;
  }

  handleCellAction(dateStr) {
    if (this.isBatchMode) {
      // 一括選択ON時：希望シフトでも確定シフトでもタップで選択/解除トグル
      this.handleCellToggleClick(dateStr);
      return;
    }

    if (this.activeTab === 'tab-confirmed') {
      // 一括選択OFF時：個別編集
      this.openSingleShiftEditModal(dateStr, 'confirmed');
    } else {
      this.openSingleShiftEditModal(dateStr, 'requested');
    }
  }

  handleCellToggleClick(dateStr) {
    if (this.selectedDates.has(dateStr)) {
      this.selectedDates.delete(dateStr);
    } else {
      this.selectedDates.add(dateStr);
    }
    this.renderCalendar();
  }

  updateSelectionInfo() {
    const actionsWrapper = document.getElementById('selection-actions-wrapper');
    const hint = document.getElementById('selection-hint');
    const toggleText = document.getElementById('batch-toggle-text');
    const toggleInput = document.getElementById('batch-select-toggle');
    const batchWrapper = document.querySelector('.batch-toggle-wrapper');
    const templatesSec = document.querySelector('.templates-section');

    if (toggleInput) {
      toggleInput.checked = this.isBatchMode;
    }
    if (toggleText) {
      toggleText.textContent = this.isBatchMode ? '一括選択: ON' : '一括選択: OFF';
    }

    if (batchWrapper) batchWrapper.style.display = 'flex';

    const hasSelection = this.selectedDates.size > 0;
    if (actionsWrapper) {
      actionsWrapper.style.display = hasSelection ? 'flex' : 'none';
    }

    const deleteBtn = document.getElementById('btn-delete-selected-shifts');

    if (this.activeTab === 'tab-confirmed') {
      if (templatesSec) templatesSec.style.display = 'none';
      if (deleteBtn) deleteBtn.innerHTML = '🗑️ シフト削除';

      if (this.isBatchMode) {
        if (hint) {
          hint.textContent = hasSelection 
            ? '👆 選択した日程を「シフト削除」で一括削除できます' 
            : '👆 日付を選択して「シフト削除」で一括削除';
        }
      } else {
        if (hint) hint.textContent = '👆 日付または下の一覧から確定シフトを個別に修正・削除';
      }
      return;
    }

    // 希望シフト画面
    if (templatesSec) templatesSec.style.display = 'flex';
    if (deleteBtn) deleteBtn.innerHTML = '🗑️ プラン削除';

    if (!this.isBatchMode) {
      if (hint) hint.textContent = '👆 日付をタップして個別に時間・件名・コメントを入力';
      return;
    }

    // 希望シフトの一括選択モード
    if (hint) {
      hint.textContent = hasSelection 
        ? '👆 タップで選択/解除、ドラッグで範囲選択（下のプランで一括登録）'
        : '👆 タップで複数選択、ドラッグで範囲選択';
    }
  }

  clearSelection() {
    this.selectedDates.clear();
    this.renderCalendar();
  }

  // ============================================================
  // 個別シフト編集モーダル (要件1 & 要件2)
  // ============================================================
  openSingleShiftEditModal(dateStr, target = 'requested') {
    this.editingSingleDate = dateStr;
    this.editingSingleTarget = target;

    const modal = document.getElementById('single-shift-modal');
    const title = document.getElementById('single-shift-modal-title');
    const deleteBtn = document.getElementById('btn-delete-single-shift');
    const typeSelect = document.getElementById('single-shift-type');
    const startInput = document.getElementById('single-shift-start');
    const endInput = document.getElementById('single-shift-end');
    const nameInput = document.getElementById('single-shift-name');
    const memoInput = document.getElementById('single-shift-memo');
    const timeGroup = document.getElementById('single-shift-time-group');

    const [year, month, day] = dateStr.split('-');
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const formattedDate = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;

    const isConfirmed = (target === 'confirmed');
    if (title) {
      title.textContent = isConfirmed 
        ? `✏️ ${formattedDate} 確定シフト編集` 
        : `📅 ${formattedDate} シフト入力`;
    }

    const targetStore = isConfirmed ? this.confirmedShifts : this.requestedShifts;
    const existing = targetStore[dateStr];

    if (existing) {
      if (typeSelect) typeSelect.value = existing.type || '01|0';
      if (startInput) startInput.value = existing.start || '18:00';
      if (endInput) endInput.value = existing.end || '23:00';
      if (nameInput) nameInput.value = existing.name || existing.memo || '';
      if (memoInput) memoInput.value = existing.memo || '';
      if (deleteBtn) deleteBtn.style.display = 'block';
    } else {
      if (typeSelect) typeSelect.value = '01|0';
      if (startInput) startInput.value = '18:00';
      if (endInput) endInput.value = '23:00';
      if (nameInput) nameInput.value = '';
      if (memoInput) memoInput.value = '';
      if (deleteBtn) deleteBtn.style.display = 'none';
    }

    const updateTimeVisibility = () => {
      if (timeGroup) {
        timeGroup.style.display = (typeSelect && typeSelect.value === '03|1') ? 'none' : 'flex';
      }
    };
    if (typeSelect) typeSelect.onchange = updateTimeVisibility;
    updateTimeVisibility();

    this.renderSingleTemplateShortcuts();
    if (modal) modal.classList.add('show');
  }

  closeSingleShiftModal() {
    const modal = document.getElementById('single-shift-modal');
    if (modal) modal.classList.remove('show');
    this.editingSingleDate = null;
  }

  saveSingleShiftFromModal() {
    if (!this.editingSingleDate) return;
    const dateStr = this.editingSingleDate;
    const isConfirmed = (this.editingSingleTarget === 'confirmed');

    const type = document.getElementById('single-shift-type')?.value || '01|0';
    const isPaidLeave = (type === '03|1');
    const start = isPaidLeave ? '10:00' : (document.getElementById('single-shift-start')?.value || '18:00');
    const end = isPaidLeave ? '17:00' : (document.getElementById('single-shift-end')?.value || '23:00');
    const name = document.getElementById('single-shift-name')?.value.trim() || (isPaidLeave ? '有給' : '勤務');
    const memo = document.getElementById('single-shift-memo')?.value.trim() || '';

    const shiftData = {
      type,
      start,
      end,
      name,
      memo: memo || name
    };

    if (isConfirmed) {
      this.confirmedShifts[dateStr] = shiftData;
      this.saveConfirmedShifts();
      this.showToast(`${dateStr} の確定シフトを更新しました`);
    } else {
      this.requestedShifts[dateStr] = shiftData;
      this.saveRequestedShifts();
      this.showToast(`${dateStr} の希望シフトを保存しました`);
    }

    this.closeSingleShiftModal();
    this.renderCalendar();
    this.renderSalarySummary();
  }

  deleteSingleShift(dateStr, target = 'requested') {
    const isConfirmed = (target === 'confirmed');
    const targetStore = isConfirmed ? this.confirmedShifts : this.requestedShifts;

    if (targetStore[dateStr]) {
      delete targetStore[dateStr];
      if (isConfirmed) {
        this.saveConfirmedShifts();
        this.showToast(`${dateStr} の確定シフトを削除しました`);
      } else {
        this.saveRequestedShifts();
        this.showToast(`${dateStr} の希望シフトを削除しました`);
      }
      this.renderCalendar();
      this.renderSalarySummary();
    }
  }

  deleteSingleShiftFromModal() {
    if (!this.editingSingleDate) return;
    this.deleteSingleShift(this.editingSingleDate, this.editingSingleTarget);
    this.closeSingleShiftModal();
  }

  // ============================================================
  // 定型テンプレート適用
  // ============================================================
  applyTemplate(templateId) {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) return;

    if (this.selectedDates.size === 0) {
      if (!this.isBatchMode) {
        this.showToast('一括選択モードをONにすると複数日一括登録できます');
      } else {
        this.showToast('カレンダーの日付をタップまたはドラッグして選択してください');
      }
      return;
    }

    const targetStore = (this.activeTab === 'tab-confirmed') ? this.confirmedShifts : this.requestedShifts;

    this.selectedDates.forEach(dateStr => {
      targetStore[dateStr] = {
        type: '01|0',
        start: tpl.start,
        end: tpl.end,
        name: tpl.name,
        memo: tpl.name
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
  // FoodIT 連携ダイアログ (要件4: 未選択時は今開いている月のシフトを自動対象に)
  // ============================================================
  openFoodITSubmitModal() {
    let targetDates = [];
    let isCurrentMonthDefault = false;

    if (this.selectedDates.size > 0) {
      targetDates = Array.from(this.selectedDates);
    } else {
      // ★要件4: なにも選択していない場合は今開いている月の登録済み希望シフトを自動抽出！
      const year = this.currentDate.getFullYear();
      const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
      const prefix = `${year}-${month}`;
      targetDates = Object.keys(this.requestedShifts).filter(d => d.startsWith(prefix));
      isCurrentMonthDefault = true;
    }

    // 選択された日付の中で希望シフトが存在するものを抽出
    const targets = targetDates
      .sort()
      .map(dateStr => ({ dateStr, shift: this.requestedShifts[dateStr] }))
      .filter(item => item.shift && item.shift.start && item.shift.end);

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth() + 1;

    if (targets.length === 0) {
      if (isCurrentMonthDefault) {
        this.showToast(`${year}年${month}月の希望シフトがまだ登録されていません`);
      } else {
        this.showToast('選択した日付に希望シフトが入力されていません');
      }
      return;
    }

    const modal = document.getElementById('foodit-modal');
    const titleElem = document.getElementById('foodit-modal-title');
    const descElem = document.getElementById('foodit-modal-desc');
    const listContainer = document.getElementById('foodit-shift-list');
    listContainer.innerHTML = '';

    if (titleElem) {
      titleElem.textContent = isCurrentMonthDefault
        ? `シフト希望申請 (${year}年${month}月度 全${targets.length}件)`
        : `シフト希望申請 (${targets.length}件選択中)`;
    }
    if (descElem) {
      descElem.textContent = isCurrentMonthDefault
        ? `現在表示中の${year}年${month}月に登録されている希望シフト（全${targets.length}件）をFoodITへ送信します。`
        : `選択した${targets.length}日間のシフトをFoodITへ送信します。`;
    }

    this.pendingSubmitTargets = targets;

    document.getElementById('btn-foodit-submit-all').style.display = 'flex';
    targets.forEach(({ dateStr, shift }) => {
      const item = document.createElement('div');
      item.className = 'confirmed-item';
      item.innerHTML = `
        <div>
          <div class="confirmed-date">${dateStr}</div>
          <div class="confirmed-time">${shift.start}〜${shift.end} ${shift.name ? `(${shift.name})` : ''}</div>
          ${shift.memo && shift.memo !== shift.name ? `<div class="confirmed-memo">💬 ${shift.memo}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="header-btn" style="background:var(--c-primary);color:#fff;" onclick="window.app.submitSingleFoodIT('${dateStr}')">送信</button>
          <button class="header-btn" style="background:#f1f5f9;color:var(--c-primary);" onclick="window.app.showCurl('${dateStr}')">cURL</button>
        </div>
      `;
      listContainer.appendChild(item);
    });

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
    const targets = this.pendingSubmitTargets || [];
    if (targets.length === 0) {
      this.showToast('申請対象のシフトがありません');
      return;
    }

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

    if (confirm(`表示中の${targets.length}日分のシフトを申請しますか？`)) {
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

        const [yStr, mStr, dStr] = dateStr.split('-');
        const dObj = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
        const wDays = ['日', '月', '火', '水', '木', '金', '土'];
        const wDayStr = wDays[dObj.getDay()];

        item.innerHTML = `
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="confirmed-date">${dateStr} (${wDayStr})</span>
              <span class="confirmed-badge">${shift.name || '勤務'}</span>
            </div>
            <div class="confirmed-time">${shift.start}〜${shift.end} (実働:${calc.totalWorkHours}h / 休:${calc.breakMinutes}分)</div>
            ${shift.memo && shift.memo !== shift.name ? `<div class="confirmed-memo">💬 ${shift.memo}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <div class="confirmed-pay-val">¥${calc.totalPay.toLocaleString()}</div>
            <div class="confirmed-pay-hours">残業:${calc.overtimeHours}h 賄い:-¥${calc.makanaiDeduction}</div>
            <div style="display:flex;gap:4px;margin-top:2px;">
              <button class="header-btn" style="background:var(--c-primary);color:#fff;padding:2px 8px;font-size:0.7rem;" onclick="window.app.openSingleShiftEditModal('${dateStr}', '${this.salaryMode}')">✏️修正</button>
              <button class="header-btn" style="background:#fee2e2;color:#dc2626;border:1px solid #f87171;padding:2px 8px;font-size:0.7rem;" onclick="window.app.deleteSingleShift('${dateStr}', '${this.salaryMode}')">🗑️削除</button>
            </div>
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
    const calTitleInput = document.getElementById('setting-calendar-title');

    if (storeInput) storeInput.value = this.settings.storeCode || '';
    if (empInput) empInput.value = this.settings.empCode || '';
    if (paramPreview) paramPreview.textContent = `Param=${this.settings.param || ''}`;
    if (regWageInput) regWageInput.value = this.settings.regularWage || 1300;
    if (nightWageInput) nightWageInput.value = this.settings.nightWage || 1625;
    if (makanaiInput) makanaiInput.value = this.settings.makanaiDeduction || 320;
    if (calTitleInput) calTitleInput.value = this.settings.calendarEventTitle || 'れい　バイト';

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
  // Googleカレンダー連携 (.ics)
  // ============================================================
  openCalendarExportModal() {
    const shiftsToExport = this.getConfirmedShiftsForExport();
    if (shiftsToExport.length === 0) {
      this.showToast('エクスポート対象の確定シフトがありません');
      return;
    }

    const modal = document.getElementById('calendar-export-modal');
    const titleInput = document.getElementById('export-event-title');
    const scopeDesc = document.getElementById('export-scope-desc');

    if (titleInput) {
      titleInput.value = this.settings.calendarEventTitle || 'れい　バイト';
    }

    if (scopeDesc) {
      if (this.selectedDates.size > 0) {
        scopeDesc.textContent = `選択中の日程から確定シフト ${shiftsToExport.length} 件`;
      } else {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth() + 1;
        scopeDesc.textContent = `${year}年${month}月の確定シフト全件 (${shiftsToExport.length} 件)`;
      }
    }

    if (modal) modal.classList.add('active');
  }

  closeCalendarExportModal() {
    const modal = document.getElementById('calendar-export-modal');
    if (modal) modal.classList.remove('active');
  }

  getConfirmedShiftsForExport() {
    const list = [];
    if (this.selectedDates.size > 0) {
      // 選択中の日付のみ
      const sortedDates = Array.from(this.selectedDates).sort();
      sortedDates.forEach(dateStr => {
        if (this.confirmedShifts[dateStr]) {
          list.push({ date: dateStr, shift: this.confirmedShifts[dateStr] });
        }
      });
    } else {
      // 現在表示中の月の確定シフト全件
      const year = this.currentDate.getFullYear();
      const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
      const prefix = `${year}-${month}`;

      const dates = Object.keys(this.confirmedShifts)
        .filter(d => d.startsWith(prefix))
        .sort();

      dates.forEach(d => {
        list.push({ date: d, shift: this.confirmedShifts[d] });
      });
    }
    return list;
  }

  exportConfirmedShiftsToICS() {
    const shiftsToExport = this.getConfirmedShiftsForExport();
    if (shiftsToExport.length === 0) {
      this.showToast('エクスポート対象の確定シフトがありません');
      return;
    }

    const titleInput = document.getElementById('export-event-title');
    const eventTitle = titleInput?.value.trim() || this.settings.calendarEventTitle || 'れい　バイト';

    if (eventTitle !== this.settings.calendarEventTitle) {
      this.settings.calendarEventTitle = eventTitle;
      this.saveSettings();
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Shift Master//FoodIT Shift Exporter//JA',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + eventTitle,
      'X-WR-TIMEZONE:Asia/Tokyo',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Tokyo',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:JST',
      'END:STANDARD',
      'END:VTIMEZONE'
    ];

    shiftsToExport.forEach((item, index) => {
      const { date, shift } = item;
      const [yStr, mStr, dStr] = date.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const d = parseInt(dStr, 10);

      const startParts = (shift.start || '10:00').split(':');
      const startH = parseInt(startParts[0] || '10', 10);
      const startM = parseInt(startParts[1] || '0', 10);

      const endParts = (shift.end || '17:00').split(':');
      const endH = parseInt(endParts[0] || '17', 10);
      const endM = parseInt(endParts[1] || '0', 10);

      const startDate = new Date(y, m - 1, d, startH, startM, 0);
      let endDate;
      if (endH >= 24) {
        endDate = new Date(y, m - 1, d + 1, endH - 24, endM, 0);
      } else {
        endDate = new Date(y, m - 1, d, endH, endM, 0);
        if (endDate <= startDate) {
          endDate.setDate(endDate.getDate() + 1);
        }
      }

      const formatDT = (dt) => {
        return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
      };

      const dtStartStr = formatDT(startDate);
      const dtEndStr = formatDT(endDate);
      const uid = `shift-${date}-${index}-${now.getTime()}@shiftmaster.local`;
      const description = `${shift.name || ''} (${shift.start}〜${shift.end}) ${shift.memo || ''}`.trim();

      icsLines.push('BEGIN:VEVENT');
      icsLines.push(`UID:${uid}`);
      icsLines.push(`DTSTAMP:${dtstamp}`);
      icsLines.push(`DTSTART;TZID=Asia/Tokyo:${dtStartStr}`);
      icsLines.push(`DTEND;TZID=Asia/Tokyo:${dtEndStr}`);
      icsLines.push(`SUMMARY:${eventTitle}`);
      if (description) {
        icsLines.push(`DESCRIPTION:${description}`);
      }
      icsLines.push('STATUS:CONFIRMED');
      icsLines.push('END:VEVENT');
    });

    icsLines.push('END:VCALENDAR');

    const icsContent = icsLines.join('\r\n');
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileSuffix = this.selectedDates.size > 0 ? 'selected' : `${this.currentDate.getFullYear()}${pad(this.currentDate.getMonth() + 1)}`;
    link.setAttribute('download', `${eventTitle}_${fileSuffix}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.closeCalendarExportModal();
    this.showToast(`確定シフト ${shiftsToExport.length} 件をカレンダーファイル(.ics)として出力しました！`);
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

    // 選択プラン削除ボタン（カレンダー操作バー）
    document.getElementById('btn-delete-selected-shifts')?.addEventListener('click', () => {
      this.deleteSelectedShifts();
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

    // Googleカレンダー出力モーダル
    document.getElementById('btn-open-calendar-export')?.addEventListener('click', () => {
      this.openCalendarExportModal();
    });
    document.getElementById('btn-close-calendar-modal')?.addEventListener('click', () => {
      this.closeCalendarExportModal();
    });
    document.getElementById('btn-do-export-ics')?.addEventListener('click', () => {
      this.exportConfirmedShiftsToICS();
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

    // 一括選択トグルスイッチ
    document.getElementById('batch-select-toggle')?.addEventListener('change', (e) => {
      this.isBatchMode = e.target.checked;
      this.selectedDates.clear();
      this.updateSelectionInfo();
      this.renderCalendar();
      this.showToast(this.isBatchMode ? '一括選択モード: 複数日を選択できます' : '個別入力モード: 日付をタップして編集できます');
    });

    // 個別シフト編集モーダルボタン
    document.getElementById('btn-close-single-shift')?.addEventListener('click', () => {
      this.closeSingleShiftModal();
    });
    document.getElementById('btn-save-single-shift')?.addEventListener('click', () => {
      this.saveSingleShiftFromModal();
    });
    document.getElementById('btn-delete-single-shift')?.addEventListener('click', () => {
      this.deleteSingleShiftFromModal();
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
      this.settings.calendarEventTitle = document.getElementById('setting-calendar-title')?.value.trim() || 'れい　バイト';
      this.updateParam();
      document.getElementById('setting-param-preview').textContent = `Param=${this.settings.param}`;
    };

    ['setting-store-code', 'setting-emp-code', 'setting-regular-wage', 'setting-night-wage', 'setting-makanai', 'setting-calendar-title'].forEach(id => {
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

    // 設定画面の時はカレンダーを非表示、入力・給与タブでは表示
    const calWrapper = document.getElementById('calendar-wrapper');
    if (calWrapper) {
      calWrapper.style.display = (tabId === 'tab-settings') ? 'none' : 'flex';
    }

    // タブ切り替え時にカレンダー表示を更新
    this.selectedDates.clear();
    this.updateSelectionInfo();
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
