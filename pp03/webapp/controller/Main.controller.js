sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/base/Log"
  ],
  (Controller, JSONModel, Filter, FilterOperator, MessageToast, Log) => {
    "use strict";

    return Controller.extend("code.t4.ui5.pp03.controller.Main", {
      onInit() {
        // 화면 바인딩용 로컬 모델
        this.getView().setModel(
          new JSONModel({
            busy: true,
            loaded: false,
            hasData: false,
            aufnr: "",
            year: 2026,
            kpi: {},
            wcLoad: [],
            lead: [],
            monthly: [],
            status: { done: 0, run: 0, schd: 0, total: 0 },
            flowNodes: []
          }),
          "ui"
        );

        // cross-app navigation 으로 전달된 오더번호 확보
        const oComp = this.getOwnerComponent();
        const oStartup =
          oComp.getComponentData && oComp.getComponentData()
            ? oComp.getComponentData().startupParameters
            : null;
        if (oStartup && oStartup.aufnr && oStartup.aufnr.length) {
          this._sAufnr = oStartup.aufnr[0];
          this.getView().getModel("ui").setProperty("/aufnr", this._sAufnr);
        }

        this._loadData();
      },

      /* ================= 데이터 로딩 ================= */

      _loadData() {
        const oUi = this.getView().getModel("ui");
        oUi.setProperty("/busy", true);

        const oComp = this.getOwnerComponent();
        const oModel02 = oComp.getModel(); // 0002 (default)
        const oModel09 = oComp.getModel("wc"); // 0009
        const oModel10 = oComp.getModel("log"); // 0010

        // aufnr 가 있으면 해당 오더로 필터, 없으면 전체 집계
        const aF02 = this._sAufnr
          ? [new Filter("aufnr", FilterOperator.EQ, this._sAufnr)]
          : [];
        const aF09 = this._sAufnr
          ? [new Filter("Aufnr", FilterOperator.EQ, this._sAufnr)]
          : [];
        const aF10 = this._sAufnr
          ? [new Filter("Aufnr", FilterOperator.EQ, this._sAufnr)]
          : [];

        Promise.all([
          this._read(oModel02, "/ZCDS_D4_PP_0002", aF02),
          this._read(oModel09, "/ZCDS_D4_PP_0009", aF09),
          this._read(oModel10, "/ZCDS_D4_PP_0010", aF10)
        ])
          .then((aRes) => {
            this._process(aRes[0], aRes[1], aRes[2]);
          })
          .catch((oErr) => {
            Log.error("PP dashboard load failed", oErr && oErr.message);
            oUi.setProperty("/busy", false);
            oUi.setProperty("/loaded", true);
            oUi.setProperty("/hasData", false);
            MessageToast.show(this._t("loadError"));
          });
      },

      _read(oModel, sPath, aFilters) {
        return new Promise((resolve, reject) => {
          oModel.read(sPath, {
            filters: aFilters,
            urlParameters: { $top: 5000 },
            success: (oData) => resolve((oData && oData.results) || []),
            error: reject
          });
        });
      },

      /* ================= KPI 계산 ================= */

      _process(aHead, aOp, aLog) {
        const oUi = this.getView().getModel("ui");

        // --- 공정 상태 분포 (0009 Statu) ---
        let iDone = 0,
          iRun = 0,
          iSchd = 0;
        aOp.forEach((r) => {
          const s = (r.Statu || "").toUpperCase();
          if (s === "DONE" || s === "CLSD") {
            iDone++;
          } else if (s === "RUN" || s === "REL" || s === "PROC") {
            iRun++;
          } else {
            iSchd++;
          }
        });
        const iTotal = aOp.length;
        const iCompletion = iTotal ? Math.round((iDone / iTotal) * 100) : 0;

        // --- 워크센터 부하 : Arbpl 별 Vgw02(기계시간) 합 + 상태 집계 ---
        const mWc = {};
        const mWcStatus = {};
        aOp.forEach((r) => {
          const sWc = (r.Arbpl || "-").trim();
          const fH = parseFloat(r.Vgw02) || 0;
          mWc[sWc] = (mWc[sWc] || 0) + fH;

          if (!mWcStatus[sWc]) {
            mWcStatus[sWc] = { done: 0, run: 0, total: 0 };
          }
          mWcStatus[sWc].total++;
          const s = (r.Statu || "").toUpperCase();
          if (s === "DONE" || s === "CLSD") {
            mWcStatus[sWc].done++;
          } else if (s === "RUN" || s === "REL" || s === "PROC") {
            mWcStatus[sWc].run++;
          }
        });
        const aWcKeys = Object.keys(mWc).sort();
        // 기계시간(Vgw02) 합이 모두 0 이면 공정 건수로 폴백
        const fTotalHours = aWcKeys.reduce((s, k) => s + mWc[k], 0);
        const bUseHours = fTotalHours > 0;
        const sValUnit = bUseHours ? this._t("valUnitHour") : "";
        const aRaw = aWcKeys.map((sWc) => {
          const st = mWcStatus[sWc];
          return {
            wc: sWc,
            val: bUseHours ? this._r1(mWc[sWc]) : st.total,
            st: st
          };
        });
        const fMaxLoad = Math.max.apply(
          null,
          aRaw.map((o) => o.val).concat([1])
        );
        const aWcLoad = aRaw.map((o) => {
          return {
            wc: o.wc,
            hours: o.val,
            display: String(o.val) + sValUnit,
            // 막대 높이 = 부하/최대부하 (최소 4%는 보이게)
            barPct: Math.max(Math.round((o.val / fMaxLoad) * 100), 4) + "%",
            // 막대 안 초록 채움 = 완료 공정 비율 (파랑=생산 중, 초록=완료)
            donePct:
              (o.st.total ? Math.round((o.st.done / o.st.total) * 100) : 0) + "%"
          };
        });
        const sLoadUnit = bUseHours
          ? this._t("loadUnitHours")
          : this._t("loadUnitCount");

        // --- 공정 흐름 노드 (워크센터 순서) ---
        // 워크센터 코드 → 한글명 + 아이콘 (SAP 아이콘 폰트에 존재하는 이름)
        const mWcInfo = {
          "WC-100": { name: this._t("wcName100"), icon: "sap-icon://machine" },
          "WC-200": { name: this._t("wcName200"), icon: "sap-icon://supplier" },
          "WC-300": { name: this._t("wcName300"), icon: "sap-icon://puzzle" },
          "WC-400": { name: this._t("wcName400"), icon: "sap-icon://building" },
          "WC-500": { name: this._t("wcName500"), icon: "sap-icon://product" }
        };
        const aFlow = aWcKeys.map((sWc, i) => {
          const st = mWcStatus[sWc];
          const oStatus = this._wcStatusInfo(st);
          const oInfo = mWcInfo[sWc] || {
            name: sWc,
            icon: "sap-icon://process"
          };
          return {
            code: sWc,
            title: oInfo.name,
            icon: oInfo.icon,
            iconColor: oStatus.color,
            stateText: oStatus.text,
            caption: this._t("flowCaption", [sWc, st.done, st.total]),
            last: i === aWcKeys.length - 1
          };
        });

        // --- 리드타임 : 0002 예정(gltrs-gstrs) vs 실제(gltri-gstri) 평균 ---
        let fPlanSum = 0,
          iPlanN = 0,
          fActSum = 0,
          iActN = 0;
        aHead.forEach((r) => {
          const dPs = this._toDate(r.gstrs),
            dPe = this._toDate(r.gltrs);
          const dAs = this._toDate(r.gstri),
            dAe = this._toDate(r.gltri);
          if (dPs && dPe) {
            fPlanSum += (dPe - dPs) / 86400000;
            iPlanN++;
          }
          if (dAs && dAe) {
            fActSum += (dAe - dAs) / 86400000;
            iActN++;
          }
        });
        const fLeadPlan = this._r1(iPlanN ? fPlanSum / iPlanN : 0);
        const fLeadActual = this._r1(iActN ? fActSum / iActN : 0);
        const aLead = [
          {
            title: this._t("leadPlan"),
            value: fLeadPlan,
            display: this._t("leadDisplay", [fLeadPlan]),
            color: "Neutral"
          },
          {
            title: this._t("leadActual"),
            value: fLeadActual,
            display: this._t("leadDisplay", [fLeadActual]),
            color: fLeadActual <= fLeadPlan ? "Good" : "Error"
          }
        ];

        // --- 월별 완료량 : 0010 Idat 월별 누적 Gmnga 최대값 ---
        const mMonth = {};
        let sQtyUnit = "";
        aLog.forEach((r) => {
          const d = this._toDate(r.Idat);
          if (!d) {
            return;
          }
          const m = d.getMonth() + 1;
          const q = parseFloat(r.Gmnga) || 0;
          mMonth[m] = Math.max(mMonth[m] || 0, q);
          if (!sQtyUnit && r.Gmein) {
            sQtyUnit = r.Gmein;
          }
        });
        const aMonthKeys = Object.keys(mMonth)
          .map(Number)
          .sort((a, b) => a - b);
        const aMonthly = aMonthKeys.map((m) => ({
          x: m,
          label: this._t("monthLabel", [m]),
          value: mMonth[m]
        }));
        let sMonthCaption = "-",
          iPeakM = 0,
          fPeakV = -1;
        aMonthKeys.forEach((m) => {
          if (mMonth[m] > fPeakV) {
            fPeakV = mMonth[m];
            iPeakM = m;
          }
        });
        if (aMonthKeys.length) {
          sMonthCaption = this._t("monthCaption", [
            aMonthKeys[0],
            aMonthKeys[aMonthKeys.length - 1],
            iPeakM
          ]);
        }

        // --- 모델 반영 ---
        oUi.setData({
          busy: false,
          loaded: true,
          hasData: iTotal > 0 || aHead.length > 0,
          aufnr: this._sAufnr || "",
          year: 2026,
          kpi: {
            completion: iCompletion,
            completionCaption: this._t("completionCaption", [iDone, iTotal]),
            wcCaption: this._t("wcCaption", [aWcKeys.length, sLoadUnit]),
            leadCaption: this._t("leadCaption", [fLeadPlan, fLeadActual]),
            monthCaption: sMonthCaption,
            monthFirst: aMonthly.length ? aMonthly[0].label : "",
            monthLast: aMonthly.length
              ? aMonthly[aMonthly.length - 1].label
              : "",
            qtyUnit: sQtyUnit
          },
          wcLoad: aWcLoad,
          lead: aLead,
          monthly: aMonthly,
          status: { done: iDone, run: iRun, schd: iSchd, total: iTotal },
          flowNodes: aFlow
        });
      },

      /* ================= 이벤트 ================= */

      onSearch(oEvent) {
        const sVal = (oEvent.getParameter("query") || "").trim().toUpperCase();
        this._sAufnr = sVal || null;
        this.getView().getModel("ui").setProperty("/aufnr", sVal);
        this._loadData();
      },

      /* ================= 포맷터 / 헬퍼 ================= */

      formatTitle(sPattern, vYear) {
        return (sPattern || "").replace("{0}", "(" + (vYear || "") + ")");
      },

      _t(sKey, aArgs) {
        return this.getView()
          .getModel("i18n")
          .getResourceBundle()
          .getText(sKey, aArgs);
      },

      // 워크센터 상태 → 색/텍스트 (부하 막대·공정 흐름 공통)
      _wcStatusInfo(st) {
        if (st.run > 0) {
          return { color: "#0a6ed1", text: this._t("stateRunning") };
        }
        if (st.done === st.total && st.total > 0) {
          return { color: "#30914c", text: this._t("stateDone") };
        }
        if (st.done > 0) {
          return { color: "#0a6ed1", text: this._t("stateRunning") };
        }
        return { color: "#6a6d70", text: this._t("stateScheduled") };
      },

      _r1(n) {
        return Math.round((n || 0) * 10) / 10;
      },

      _toDate(v) {
        if (!v) {
          return null;
        }
        if (v instanceof Date) {
          return v;
        }
        if (typeof v === "string") {
          const m = /\/Date\((\d+)/.exec(v);
          if (m) {
            return new Date(parseInt(m[1], 10));
          }
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        return null;
      }
    });
  }
);
