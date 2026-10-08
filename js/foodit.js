/**
 * FoodIT Direct HTTP POST 連携モジュール
 * スクレイピング不要で、ブラウザから直接FoodITサーバーにシフト登録POSTリクエストを送信します。
 */

const FoodIT = {
  // FoodIT 基本エンドポイント
  BASE_URL: 'https://secure1.foodit.jp/CRG/mobile',
  POST_ACTION_URL: 'https://secure1.foodit.jp/CRG/mobile/shift_8.asp?ProcFlg=App#tm4',

  /**
   * 指定した日付の「その週の月曜日」を YYYYMMDD 形式で取得 (hidStYMD用)
   */
  getWeekMonday(dateObj) {
    const d = new Date(dateObj);
    const day = d.getDay(); // 0(日) 〜 6(土)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 月曜日に合わせる
    d.setDate(diff);
    return this.formatDateYYYYMMDD(d);
  },

  /**
   * Date オブジェクトを YYYYMMDD に変換
   */
  formatDateYYYYMMDD(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  },

  /**
   * 現在時刻を FoodIT 形式 (YYYY/MM/DD H:M:S) でフォーマット (hidUdate用フォールバック)
   */
  formatUdate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}:${sec}`;
  },

  /**
   * シフト登録用 POST パラメータ一式を生成
   * @param {string} dateStr "YYYY-MM-DD"
   * @param {Object} shiftData { type: "01|0" | "03|1" | "del", start: "HH:mm", end: "HH:mm", memo: "" }
   * @param {Object} settings { storeCode: "02006", empCode: "5155517", param: "02006|5155517", kgcd: "0001" }
   */
  buildParams(dateStr, shiftData, settings) {
    const [year, month, day] = dateStr.split('-');
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
    const ymd = `${year}${month}${day}`;
    const mondayYmd = this.getWeekMonday(dateObj);

    // 時間のパース
    let stH = '18', stM = '00', edH = '23', edM = '00';
    if (shiftData.start && shiftData.start.includes(':')) {
      const parts = shiftData.start.split(':');
      stH = parts[0].padStart(2, '0');
      stM = parts[1].padStart(2, '0');
    }
    if (shiftData.end && shiftData.end.includes(':')) {
      const parts = shiftData.end.split(':');
      edH = parts[0].padStart(2, '0');
      edM = parts[1].padStart(2, '0');
    }

    const isDelete = shiftData.type === 'del' || shiftData.isDelete === true;
    const isPaidLeave = shiftData.type === '03|1'; // 有休

    const params = {
      cmbSkkb: isPaidLeave ? '03|1' : '01|0', // 01|0: 出勤, 03|1: 有休
      cmbSagyo: settings.workKind || '01',    // 01: ホール
      cmbStTimeH: isPaidLeave ? '' : stH,
      cmbStTimeM: isPaidLeave ? '' : stM,
      cmbEdTimeH: isPaidLeave ? '' : edH,
      cmbEdTimeM: isPaidLeave ? '' : edM,
      cmbJikankb: '||',
      cmbStTimeH2: '',
      cmbStTimeM2: '',
      cmbEdTimeH2: '',
      cmbEdTimeM2: '',
      txtMemo: shiftData.memo || '',
      hidKgcd: settings.kgcd || '0001',
      hidLinkFlg: 'shiftTIME',
      hidShiftYMD: ymd,
      hidUdate: shiftData.udate || settings.lastUdate || this.formatUdate(),
      hidStYMD: mondayYmd,
      hidEndTM: `${edH}${edM}`,
      hidEndTM2: '',
      hidMXSKCNT: '1',
      hidSsnFlg: '2',
      hidParam: settings.param || `${settings.storeCode}|${settings.empCode}`,
      hidName: 'tm4',
      hidWRKSTR: '3',
      hidTMMAX: '3600'
    };

    if (isDelete) {
      params.chkDel = 'checked';
    }

    return params;
  },

  /**
   * モード1: ブラウザ直接フォーム送信（推奨）
   * 動的フォームを生成して FoodIT サーバーへ直接 POST。
   * CORS制約を受けず、ブラウザのCookie（セッション）がそのまま送信されます。
   */
  submitDirectForm(dateStr, shiftData, settings, openInNewTab = true) {
    const params = this.buildParams(dateStr, shiftData, settings);

    // 既存の送信フォームがあれば削除
    const oldForm = document.getElementById('foodit-post-form');
    if (oldForm) oldForm.remove();

    const form = document.createElement('form');
    form.id = 'foodit-post-form';
    form.method = 'POST';
    form.action = this.POST_ACTION_URL;
    form.target = openInNewTab ? '_blank' : '_self';
    form.style.display = 'none';

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
    }

    document.body.appendChild(form);
    form.submit();

    return {
      success: true,
      message: `${dateStr} のシフトをFoodITへ送信しました（別タブで送信完了画面が開きます）。`,
      params
    };
  },

  /**
   * モード2: cURL コマンド文字列を生成（ターミナル実行用・検証用）
   */
  generateCurlCommand(dateStr, shiftData, settings) {
    const params = this.buildParams(dateStr, shiftData, settings);
    let cmd = `curl -X POST "${this.POST_ACTION_URL}" \\\n`;
    cmd += `  -H "Content-Type: application/x-www-form-urlencoded" \\\n`;
    cmd += `  -H "Referer: ${this.BASE_URL}/shiftAppli_8.asp?ShiftYmd=${params.hidShiftYMD}&Kgcd=${params.hidKgcd}&Param=${encodeURIComponent(params.hidParam)}" \\\n`;

    const lines = [];
    for (const [key, value] of Object.entries(params)) {
      lines.push(`  --data-urlencode "${key}=${value}"`);
    }
    cmd += lines.join(' \\\n');
    return cmd;
  },

  /**
   * FoodITの各画面URLを生成
   */
  getLinks(settings) {
    const store = settings.storeCode || '02006';
    const param = settings.param || `${store}|${settings.empCode || '5155517'}`;
    const kgcd = settings.kgcd || '0001';
    return {
      login: `${this.BASE_URL}/login_8.asp?Kgcd=${kgcd}`,
      menu: `${this.BASE_URL}/menu_8.asp?kgcd=${kgcd}&Param=${encodeURIComponent(param)}`,
      calendar: `${this.BASE_URL}/shift_8.asp?Flg=0&Kgcd=${kgcd}&Param=${encodeURIComponent(param)}`
    };
  }
};

window.FoodIT = FoodIT;
