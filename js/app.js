/**
 * Shift Master - アプリケーション全体ロジック
 */

class ShiftMasterApp {
  constructor() {
    this.currentDate = new Date(); // カレンダー表示用
    this.selectedDates = new Set(); // 選択中日付 ("YYYY-MM-DD")
    this.multiSelectMode = false;   // 一括選択モード
    this.activeTab = 'tab-request';  // 現在のタブ
    
    // データ初期化
    this.loadSettings();
    this.loadShifts();

    // イベントリスナーの登録
    this.initEventListeners();
    this.initPWA();

    // 初期描画
    this.renderCalendar();
    this.renderSalarySummary();
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
      workKind: '01',
      autoBreak: true // 6時間以上45分、8時間以上60分休憩
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
    this.renderSalarySummary(); // 時給変更が給与に即反映
  }

  updateParam() {
    this.settings.param = `${this.settings.storeCode || ''}|${this.settings.empCode || ''}`;
  }

  // ============================================================
  // シフトデータ管理 (LocalStorage)
  // ============================================================
  loadShifts() {
    // 希望シフト: { "YYYY-MM-DD": { type: "01|0", start: "18:00", end: "23:00", memo: "" } }
    const savedReq = localStorage.getItem('shift_master_requested');
    this.requestedShifts = savedReq ? JSON.parse(savedReq) : {};

    // 確定シフト: { "YYYY-MM-DD": { type: "01|0", start: "18:00", end: "23:00", breakMin: 0, memo: "" } }
    const savedConf = localStorage.getItem('shift_master_confirmed');
    this.confirmedShifts = savedConf ? JSON.parse(savedConf) : {};
  }

  saveRequestedShifts() {
    localStorage.setItem('shift_master_requested', JSON.stringify(this.requestedShifts));
    this.renderCalendar();
  }

  saveConfirmedShifts() {
    localStorage.setItem('shift_master_confirmed', JSON.stringify(this.confirmedShifts));
    this.renderSalarySummary();
  }

  // ============================================================
  // 給与計算ロジック (22:00前後の精密時間分割)
  // ============================================================
  /**
   * 単一日のシフトから通常時間・深夜時間・それぞれの給与を計算
   * 通常時間帯: 10:00 〜 22:00 (基本時給: 1,300円)
   * 深夜時間帯: 22:00 〜 29:00 (翌05:00) (深夜割増25%: 1,625円)
   */
  calculateDaySalary(shift) {
    if (!shift || shift.type === 'off' || shift.type === '03|1' || !shift.start || !shift.end) {
      return { regularHours: 0, nightHours: 0, totalHours: 0, regularPay: 0, nightPay: 0, totalPay: 0 };
    }

    const [stH, stM] = shift.start.split(':').map(Number);
    const [edH, edM] = shift.end.split(':').map(Number);

    let startMinutes = stH * 60 + stM;
    let endMinutes = edH * 60 + edM;

    // 翌日にまたがる場合（例: 23:00〜翌2:00）
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }

    // 22:00の分数表現 (22 * 60 = 1320)
    const nightThreshold = 22 * 60;
    const morningThreshold = 29 * 60; // 翌朝5:00 (1740)

    let regularMinutes = 0;
    let nightMinutes = 0;

    // 1分刻みで精密積算（または区間判定）
    for (let m = startMinutes; m < endMinutes; m++) {
      const normalizedM = m % (24 * 60);
      // 深夜判定: 22:00 (1320) 〜 翌05:00 (300)
      if (normalizedM >= 1320 || normalizedM < 300) {
        nightMinutes++;
      } else {
        regularMinutes++;
      }
    }

    // 休憩時間の控除（分）
    let breakMin = shift.breakMin !== undefined ? Number(shift.breakMin) : 0;
    if (this.settings.autoBreak && breakMin === 0) {
      const totalWorkM = endMinutes - startMinutes;
      if (totalWorkM > 8 * 60) {
        breakMin = 60;
      } else if (totalWorkM > 6 * 60) {
        breakMin = 45;
      }
    }

    // 休憩時間は通常勤務から優先控除
    if (breakMin > 0) {
      if (regularMinutes >= breakMin) {
        regularMinutes -= breakMin;
      } else {
        const remaining = breakMin - regularMinutes;
        regularMinutes = 0;
        nightMinutes = Math.max(0, nightMinutes - remaining);
      }
    }

    const regularHours = regularMinutes / 60;
    const nightHours = nightMinutes / 60;
    const totalHours = regularHours + nightHours;

    const regularRate = Number(this.settings.regularWage) || 1300;
    const nightRate = Number(this.settings.nightWage) || 1625;

    const regularPay = Math.round(regularHours * regularRate);
    const nightPay = Math.round(nightHours * nightRate);
    const totalPay = regularPay + nightPay;

    return {
      regularHours: Number(regularHours.toFixed(2)),
      nightHours: Number(nightHours.toFixed(2)),
      totalHours: Number(totalHours.toFixed(2)),
      regularPay,
      nightPay,
      totalPay
    };
  }

  // ============================================================
  // カレンダー描画 (希望シフト画面)
  // ============================================================
  renderCalendar() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth(); // 0-indexed

    // 年月ラベル
    const monthLabel = document.getElementById('current-month-label');
    if (monthLabel) {
      monthLabel.textContent = `${year}年 ${month + 1}月`;
    }

    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // 曜日ヘッダー以外の既存セルを削除
    const oldDays = grid.querySelectorAll('.calendar-day');
    oldDays.forEach(d => d.remove());

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 月曜始まりの曜日インデックス (0:月, 1:火, ... 6:日)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    // 前月の末尾日を埋める
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const dateStr = this.formatDate(prevDate);
      grid.appendChild(this.createDayCell(dayNum, dateStr, true));
    }

    // 当月の日付セル
    const todayStr = this.formatDate(new Date());
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const curDate = new Date(year, month, d);
      const dateStr = this.formatDate(curDate);
      const isToday = (dateStr === todayStr);
      grid.appendChild(this.createDayCell(d, dateStr, false, isToday));
    }

    // 次月の頭日を埋めてグリッド（7列）を揃える
    const totalCells = startDayOfWeek + lastDay.getDate();
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const dateStr = this.formatDate(nextDate);
      grid.appendChild(this.createDayCell(d, dateStr, true));
    }

    this.updateMultiSelectBadge();
  }

  createDayCell(dayNum, dateStr, isOtherMonth, isToday = false) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (isOtherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');
    if (this.selectedDates.has(dateStr)) cell.classList.add('selected');

    // 曜日判定
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

    // シフト希望データがあればバッジを表示（※要件: 給与額は絶対に表示しない）
    const shift = this.requestedShifts[dateStr];
    if (shift) {
      const tag = document.createElement('div');
      tag.className = 'shift-tag';
      
      let tagText = '';
      if (shift.type === '03|1') {
        tag.classList.add('paid');
        tagText = '有休';
      } else if (shift.type === 'off') {
        tag.classList.add('off');
        tagText = '休み';
      } else {
        // 出勤の場合
        if (shift.start === '10:00' && shift.end === '17:00') {
          tag.classList.add('early');
          tagText = '早番';
        } else if (shift.start === '17:00' && shift.end === '22:00') {
          tag.classList.add('late');
          tagText = '遅番';
        } else if (shift.start === '18:00' && shift.end === '23:00') {
          tag.classList.add('last');
          tagText = 'ラスト';
        } else {
          tag.classList.add('custom');
          tagText = '出勤';
        }
      }
      tag.textContent = tagText;
      cell.appendChild(tag);

      // 時間帯表示（出勤時のみ）
      if (shift.type !== 'off' && shift.type !== '03|1' && shift.start && shift.end) {
        const timeSub = document.createElement('div');
        timeSub.className = 'shift-time-sub';
        timeSub.textContent = `${shift.start.replace(':00','')}-${shift.end.replace(':00','')}`;
        cell.appendChild(timeSub);
      }
    }

    // クリックイベント
    cell.addEventListener('click', () => {
      this.handleDayClick(dateStr);
    });

    return cell;
  }

  handleDayClick(dateStr) {
    if (this.multiSelectMode) {
      // 一括選択モード: 選択トグル
      if (this.selectedDates.has(dateStr)) {
        this.selectedDates.delete(dateStr);
      } else {
        this.selectedDates.add(dateStr);
      }
      this.renderCalendar();
    } else {
      // 単一日モード: シフト入力モーダルを開く
      this.openShiftModal(dateStr);
    }
  }

  updateMultiSelectBadge() {
    const badge = document.getElementById('selected-count-badge');
    if (badge) {
      badge.textContent = `${this.selectedDates.size}日選択中`;
      badge.style.display = this.selectedDates.size > 0 ? 'inline-block' : 'none';
    }
  }

  // ============================================================
  // 定型テンプレート適用
  // ============================================================
  applyTemplate(templateKey) {
    const templates = {
      early: { type: '01|0', start: '10:00', end: '17:00', name: '早番' },
      late:  { type: '01|0', start: '17:00', end: '22:00', name: '遅番' },
      last:  { type: '01|0', start: '18:00', end: '23:00', name: 'ラスト' },
      off:   { type: 'off',  start: '',      end: '',      name: '休み' },
      paid:  { type: '03|1', start: '',      end: '',      name: '有休' }
    };

    const targetTemplate = templates[templateKey];
    if (!targetTemplate) return;

    if (this.selectedDates.size === 0) {
      this.showToast('カレンダーの日付をタップして選択してください');
      return;
    }

    // 選択された全日付にテンプレートを適用
    this.selectedDates.forEach(dateStr => {
      this.requestedShifts[dateStr] = {
        type: targetTemplate.type,
        start: targetTemplate.start,
        end: targetTemplate.end,
        memo: ''
      };
    });

    this.saveRequestedShifts();
    this.showToast(`${this.selectedDates.size}日間に「${targetTemplate.name}」を一括設定しました`);
  }

  // ============================================================
  // 単一日シフト編集モーダル
  // ============================================================
  openShiftModal(dateStr) {
    this.editingDate = dateStr;
    const modal = document.getElementById('shift-modal');
    const title = document.getElementById('modal-shift-date');
    const curShift = this.requestedShifts[dateStr] || { type: '01|0', start: '18:00', end: '23:00', memo: '' };

    const [y, m, d] = dateStr.split('-');
    title.textContent = `${Number(m)}月${Number(d)}日の希望シフト`;

    document.getElementById('modal-shift-type').value = curShift.type || '01|0';
    document.getElementById('modal-start-time').value = curShift.start || '18:00';
    document.getElementById('modal-end-time').value = curShift.end || '23:00';
    document.getElementById('modal-shift-memo').value = curShift.memo || '';

    this.toggleTimeInputsVisibility(curShift.type);
    modal.classList.add('show');
  }

  closeShiftModal() {
    const modal = document.getElementById('shift-modal');
    modal.classList.remove('show');
    this.editingDate = null;
  }

  toggleTimeInputsVisibility(type) {
    const timeRow = document.getElementById('modal-time-row');
    if (type === 'off' || type === '03|1') {
      timeRow.style.display = 'none';
    } else {
      timeRow.style.display = 'grid';
    }
  }

  saveModalShift() {
    if (!this.editingDate) return;
    const type = document.getElementById('modal-shift-type').value;
    const start = document.getElementById('modal-start-time').value;
    const end = document.getElementById('modal-end-time').value;
    const memo = document.getElementById('modal-shift-memo').value;

    this.requestedShifts[this.editingDate] = { type, start, end, memo };
    this.saveRequestedShifts();
    this.closeShiftModal();
    this.showToast('希望シフトを保存しました');
  }

  deleteModalShift() {
    if (!this.editingDate) return;
    delete this.requestedShifts[this.editingDate];
    this.saveRequestedShifts();
    this.closeShiftModal();
    this.showToast('シフトを削除しました');
  }

  // ============================================================
  // FoodIT 連携ダイアログ (Direct HTTP POST)
  // ============================================================
  openFoodITSubmitModal() {
    const modal = document.getElementById('foodit-modal');
    const listContainer = document.getElementById('foodit-shift-list');
    listContainer.innerHTML = '';

    // 当月の希望シフト一覧を抽出
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    const monthShifts = Object.entries(this.requestedShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix))
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (monthShifts.length === 0) {
      listContainer.innerHTML = `<p style="text-align:center;color:var(--c-text-muted);padding:20px;">${year}年${Number(month)}月の希望シフトがまだ登録されていません。</p>`;
      document.getElementById('btn-foodit-submit-all').style.display = 'none';
    } else {
      document.getElementById('btn-foodit-submit-all').style.display = 'flex';
      monthShifts.forEach(([dateStr, shift]) => {
        const item = document.createElement('div');
        item.className = 'confirmed-item';
        
        const typeText = shift.type === '03|1' ? '有休' : (shift.type === 'off' ? '休み' : `${shift.start}〜${shift.end}`);
        item.innerHTML = `
          <div>
            <div class="confirmed-date">${dateStr}</div>
            <div class="confirmed-time">${typeText} ${shift.memo ? ' (' + shift.memo + ')' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="header-btn" style="background:var(--c-primary);color:#fff;" onclick="window.app.submitSingleFoodIT('${dateStr}')">POST送信</button>
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

    // Direct HTTP Form POST を実行
    const result = window.FoodIT.submitDirectForm(dateStr, shift, this.settings, true);
    this.showToast(`${dateStr} のPOST送信を実行しました（別タブをご確認ください）`);
  }

  submitAllMonthFoodIT() {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    const monthShifts = Object.entries(this.requestedShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix))
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (monthShifts.length === 0) return;

    // 順次送信
    let idx = 0;
    const sendNext = () => {
      if (idx >= monthShifts.length) {
        this.showToast('全ての希望シフトの送信が完了しました！');
        return;
      }
      const [dateStr, shift] = monthShifts[idx];
      window.FoodIT.submitDirectForm(dateStr, shift, this.settings, true);
      idx++;
      if (idx < monthShifts.length) {
        setTimeout(sendNext, 800); // サーバー負荷軽減のためディレイ
      }
    };

    if (confirm(`${monthShifts.length}日分のシフトをFoodITへDirect POST送信しますか？`)) {
      sendNext();
    }
  }

  showCurl(dateStr) {
    const shift = this.requestedShifts[dateStr];
    if (!shift) return;
    const cmd = window.FoodIT.generateCurlCommand(dateStr, shift, this.settings);
    navigator.clipboard.writeText(cmd).then(() => {
      this.showToast('cURLコマンドをクリップボードにコピーしました！ターミナルで実行できます。');
    }).catch(() => {
      prompt('cURLコマンドをコピーしてください:', cmd);
    });
  }

  // ============================================================
  // 確定シフト & 給与計算画面
  // ============================================================
  renderSalarySummary() {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    let totalRegHours = 0;
    let totalNightHours = 0;
    let totalRegPay = 0;
    let totalNightPay = 0;

    const listContainer = document.getElementById('confirmed-shift-list');
    if (listContainer) listContainer.innerHTML = '';

    const monthConf = Object.entries(this.confirmedShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix))
      .sort((a, b) => a[0].localeCompare(b[0]));

    monthConf.forEach(([dateStr, shift]) => {
      const calc = this.calculateDaySalary(shift);
      totalRegHours += calc.regularHours;
      totalNightHours += calc.nightHours;
      totalRegPay += calc.regularPay;
      totalNightPay += calc.nightPay;

      if (listContainer) {
        const item = document.createElement('div');
        item.className = 'confirmed-item';
        item.innerHTML = `
          <div>
            <div class="confirmed-date">${dateStr}</div>
            <div class="confirmed-time">${shift.start} 〜 ${shift.end} (休: ${shift.breakMin || 0}分)</div>
          </div>
          <div class="confirmed-pay">
            <div class="confirmed-pay-val">¥${calc.totalPay.toLocaleString()}</div>
            <div class="confirmed-pay-hours">${calc.totalHours}h (深夜 ${calc.nightHours}h)</div>
          </div>
        `;
        listContainer.appendChild(item);
      }
    });

    const totalHours = totalRegHours + totalNightHours;
    const totalPay = totalRegPay + totalNightPay;

    // DOMへのサマリー反映
    const sumTotalPay = document.getElementById('summary-total-pay');
    if (sumTotalPay) sumTotalPay.textContent = `¥${totalPay.toLocaleString()}`;

    const sumTotalHours = document.getElementById('summary-total-hours');
    if (sumTotalHours) sumTotalHours.textContent = `${totalHours.toFixed(1)} 時間`;

    const sumRegPay = document.getElementById('summary-regular-pay');
    if (sumRegPay) sumRegPay.textContent = `¥${totalRegPay.toLocaleString()}`;
    const sumRegHours = document.getElementById('summary-regular-hours');
    if (sumRegHours) sumRegHours.textContent = `${totalRegHours.toFixed(1)}h`;

    const sumNightPay = document.getElementById('summary-night-pay');
    if (sumNightPay) sumNightPay.textContent = `¥${totalNightPay.toLocaleString()}`;
    const sumNightHours = document.getElementById('summary-night-hours');
    if (sumNightHours) sumNightHours.textContent = `${totalNightHours.toFixed(1)}h`;

    const salaryPeriod = document.getElementById('salary-period-label');
    if (salaryPeriod) salaryPeriod.textContent = `${year}年 ${Number(month)}月度`;
  }

  /**
   * 希望シフトから確定シフトへ一括インポート
   */
  importRequestedToConfirmed() {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;

    const monthReq = Object.entries(this.requestedShifts)
      .filter(([dateStr]) => dateStr.startsWith(prefix));

    if (monthReq.length === 0) {
      this.showToast('インポート可能な希望シフトがありません');
      return;
    }

    if (!confirm(`${year}年${Number(month)}月の希望シフト(${monthReq.length}件)を確定シフトに反映しますか？`)) {
      return;
    }

    monthReq.forEach(([dateStr, shift]) => {
      if (shift.type !== 'off' && shift.type !== '03|1') {
        this.confirmedShifts[dateStr] = {
          type: shift.type,
          start: shift.start,
          end: shift.end,
          breakMin: 0,
          memo: shift.memo || ''
        };
      }
    });

    this.saveConfirmedShifts();
    this.showToast('希望シフトを確定シフトへ反映しました');
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

    if (storeInput) storeInput.value = this.settings.storeCode || '';
    if (empInput) empInput.value = this.settings.empCode || '';
    if (paramPreview) paramPreview.textContent = `Param=${this.settings.param || ''}`;
    if (regWageInput) regWageInput.value = this.settings.regularWage || 1300;
    if (nightWageInput) nightWageInput.value = this.settings.nightWage || 1625;
  }

  // ============================================================
  // UIイベント & ナビゲーション初期化
  // ============================================================
  initEventListeners() {
    // タブ切り替え
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const tabTarget = item.getAttribute('data-tab');
        this.switchTab(tabTarget);
      });
    });

    // カレンダー前月・次月・今日
    document.getElementById('prev-month-btn')?.addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.renderCalendar();
      this.renderSalarySummary();
    });

    document.getElementById('next-month-btn')?.addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.renderCalendar();
      this.renderSalarySummary();
    });

    document.getElementById('today-btn')?.addEventListener('click', () => {
      this.currentDate = new Date();
      this.renderCalendar();
      this.renderSalarySummary();
    });

    // 一括選択モードトグル
    const multiToggle = document.getElementById('multi-select-toggle');
    multiToggle?.addEventListener('change', (e) => {
      this.multiSelectMode = e.target.checked;
      if (!this.multiSelectMode) {
        this.selectedDates.clear();
      }
      this.renderCalendar();
    });

    // 定型テンプレートチップ
    document.querySelectorAll('.chip-btn[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        const templateKey = btn.getAttribute('data-template');
        this.applyTemplate(templateKey);
      });
    });

    // FoodIT送信モーダル
    document.getElementById('btn-open-foodit')?.addEventListener('click', () => {
      this.openFoodITSubmitModal();
    });
    document.getElementById('btn-close-foodit')?.addEventListener('click', () => {
      this.closeFoodITModal();
    });
    document.getElementById('btn-foodit-submit-all')?.addEventListener('click', () => {
      this.submitAllMonthFoodIT();
    });

    // シフトモーダル
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeShiftModal();
    });
    document.getElementById('btn-save-shift')?.addEventListener('click', () => {
      this.saveModalShift();
    });
    document.getElementById('btn-delete-shift')?.addEventListener('click', () => {
      this.deleteModalShift();
    });
    document.getElementById('modal-shift-type')?.addEventListener('change', (e) => {
      this.toggleTimeInputsVisibility(e.target.value);
    });

    // 確定シフトへのインポート
    document.getElementById('btn-import-requested')?.addEventListener('click', () => {
      this.importRequestedToConfirmed();
    });

    // 設定フォーム変更
    const onSettingChange = () => {
      this.settings.storeCode = document.getElementById('setting-store-code').value.trim();
      this.settings.empCode = document.getElementById('setting-emp-code').value.trim();
      this.settings.regularWage = Number(document.getElementById('setting-regular-wage').value) || 1300;
      this.settings.nightWage = Number(document.getElementById('setting-night-wage').value) || 1625;
      this.updateParam();
      document.getElementById('setting-param-preview').textContent = `Param=${this.settings.param}`;
    };

    ['setting-store-code', 'setting-emp-code', 'setting-regular-wage', 'setting-night-wage'].forEach(id => {
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
    }, 2800);
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
