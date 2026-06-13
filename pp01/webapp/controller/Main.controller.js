sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/odata/v2/ODataModel",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox,
    MessageToast,
    ODataModel,
  ) {
    "use strict";

    return Controller.extend("code.t4.ui5.pp01.controller.Main", {
      onInit: function () {
        var oViewModel = new JSONModel({
          startDate: new Date(),
          rawOperations: [],
          filteredOperations: [],
          workCenterList: [],
          workCenterStats: [],
          productionList: [],
          selectedArbpl: "",
          selectedStatu: "ALL",
        });
        this.getView().setModel(oViewModel, "view");

        var oCalendar = this.byId("opCalendar");
        oCalendar.setSelectedView(oCalendar.getViews()[0]);

        // 공정 데이터부터 로드 (성공 시 내부에서 워크센터 통계 호출)
        this._loadOperationsData();
      },
      _removeTileTooltips: function () {
        // bigTile 클래스의 모든 element에서 title 속성 제거
        var aTiles = document.querySelectorAll(".bigTile, .bigTile *");
        aTiles.forEach(function (el) {
          el.removeAttribute("title");
          el.removeAttribute("aria-label");
        });
      },

      // ============================================================
      // 데이터 불러오기
      // ============================================================

      // 공정 일정 데이터 (ZCDS_D4_PP_0006) 조회
      _loadOperationsData: function () {
        var that = this;
        var oModel = this.getOwnerComponent().getModel();
        var oViewModel = this.getView().getModel("view");

        oModel.refresh(true);

        oModel.read("/ZCDS_D4_PP_0006", {
          urlParameters: { $top: 9999 },
          success: function (oData) {
            var aResults = oData.results;
            // 조기 마감 플래그: 완료(DONE)인데 그 날 실적(Day_yield)이 0
            aResults.forEach(function (op) {
              if (op.Day_yield == null) op.Day_yield = "0";
              op._earlyDone = op.Statu === "DONE" && !parseFloat(op.Day_yield);
            });
            oViewModel.setProperty("/rawOperations", aResults);
            that._buildWorkCenterList(aResults);
            that._buildProductionList(aResults);
            that.onFilterChange();

            // 워크센터 통계는 raw 데이터가 있어야 today_qty 계산 가능
            that._loadWorkCenterStats();
          },
        });
      },

      // 워크센터 통계 (ZCDS_D4_PP_0007) 조회 + 오늘 GAMNG 합산
      _loadWorkCenterStats: function () {
        var oWcModel = this.getOwnerComponent().getModel("second");
        var oViewModel = this.getView().getModel("view");
        var aRaw = oViewModel.getProperty("/rawOperations") || [];

        // 오늘 날짜 자정 기준
        var oToday = new Date();
        oToday.setHours(0, 0, 0, 0);
        var nTodayTs = oToday.getTime();

        // 워크센터별 오늘 일별 계획수량 합계
        var oTodayQtyByWc = {};
        aRaw.forEach(function (op) {
          if (!op.Gstrs) return;
          var d = op.Gstrs instanceof Date ? op.Gstrs : new Date(op.Gstrs);
          d.setHours(0, 0, 0, 0);
          if (d.getTime() === nTodayTs) {
            var sArbpl = op.Arbpl;
            var nQty = parseFloat(op.Gamng) || 0;
            oTodayQtyByWc[sArbpl] = (oTodayQtyByWc[sArbpl] || 0) + nQty;
          }
        });

        oWcModel.read("/ZCDS_D4_PP_0007", {
          urlParameters: { $orderby: "Arbpl asc" },
          success: function (oData) {
            var aStats = oData.results.map(function (item) {
              var sArbpl = item.Arbpl || "";
              var nTodayQty = oTodayQtyByWc[sArbpl] || 0;
              var nCapac = parseFloat(item.Capac) || 0;

              // 오늘 부하율 계산
              var nLoadPct =
                nCapac > 0 ? Math.round((nTodayQty * 100) / nCapac) : 0;

              return {
                arbpl: sArbpl,
                ktext: item.Ktext || "",
                schd: parseInt(item.Schd_cnt, 10) || 0,
                run: parseInt(item.Run_cnt, 10) || 0,
                done: parseInt(item.Done_cnt, 10) || 0,
                total: parseInt(item.Total_cnt, 10) || 0,
                capac: nCapac,
                donePct: parseFloat(item.Progress_pct) || 0,
                today_qty: nTodayQty,
                loadPct: nLoadPct, // 추가
              };
            });
            oViewModel.setProperty("/workCenterStats", aStats);
          },
        });
      },

      // ============================================================
      // 데이터 가공
      // ============================================================

      // 작업장 드롭다운 옵션 만들기
      _buildWorkCenterList: function (aResults) {
        var aItems = [];
        var oSeen = {};

        for (var i = 0; i < aResults.length; i++) {
          var sArbpl = aResults[i].Arbpl;
          if (oSeen[sArbpl]) continue;
          oSeen[sArbpl] = true;

          aItems.push({
            arbpl: sArbpl,
            ktext: aResults[i].ktext || aResults[i].Ktext || "",
          });
        }

        // 작업장 코드 오름차순 정렬
        aItems.sort(function (a, b) {
          return a.arbpl < b.arbpl ? -1 : a.arbpl > b.arbpl ? 1 : 0;
        });

        // '전체'는 맨 위 고정
        var aList = [{ arbpl: "", ktext: "전체" }].concat(aItems);
        this.getView().getModel("view").setProperty("/workCenterList", aList);
      },

      // 현재 생산 중(RUN) 오더 리스트 만들기 - 최신 등록순 정렬
      _buildProductionList: function (aResults) {
        var aRun = aResults.filter(function (op) {
          return op.Statu === "RUN";
        });

        // Erdat(등록일) 내림차순, 같은 날은 Erzet(등록시각) 내림차순
        aRun.sort(function (a, b) {
          var ta = a.Erdat ? new Date(a.Erdat).getTime() : 0;
          var tb = b.Erdat ? new Date(b.Erdat).getTime() : 0;
          if (tb !== ta) return tb - ta;
          var za = a.Erzet && a.Erzet.ms != null ? a.Erzet.ms : 0;
          var zb = b.Erzet && b.Erzet.ms != null ? b.Erzet.ms : 0;
          return zb - za;
        });

        // 워크센터(공정) 단위 데이터라 같은 오더가 여러 줄 → 오더번호 기준 중복 제거
        var oSeen = {};
        var aUnique = aRun.filter(function (op) {
          if (oSeen[op.Aufnr]) {
            return false;
          }
          oSeen[op.Aufnr] = true;
          return true;
        });

        this.getView().getModel("view").setProperty("/productionList", aUnique);
      },

      // 생산중 리스트 검색 (오더/자재/작업장)
      onProductionSearch: function (oEvent) {
        var sQuery = oEvent.getParameter("query");
        if (sQuery === undefined) {
          sQuery = oEvent.getParameter("newValue");
        }

        var aFilters = [];
        if (sQuery && sQuery.length > 0) {
          aFilters.push(
            new Filter({
              filters: [
                new Filter("Aufnr", FilterOperator.Contains, sQuery),
                new Filter("Matnr", FilterOperator.Contains, sQuery),
                new Filter("Maktx", FilterOperator.Contains, sQuery),
                new Filter("Arbpl", FilterOperator.Contains, sQuery),
                new Filter("ktext", FilterOperator.Contains, sQuery),
              ],
              and: false,
            }),
          );
        }

        var oBinding = this.byId("productionTable").getBinding("items");
        oBinding.filter(aFilters);
      },

      // ============================================================
      // 생산 오더 승인 신청 (Approval)
      // ============================================================

      // 자재 콤보박스 옵션 만들기 (조회 데이터에서 유니크 자재)
      _buildMaterialList: function (aResults) {
        var aList = [];
        var oSeen = {};
        aResults.forEach(function (op) {
          if (!op.Matnr || oSeen[op.Matnr]) return;
          oSeen[op.Matnr] = true;
          aList.push({
            matnr: op.Matnr,
            maktx: op.Maktx || "",
            gmein: op.Gmein || "",
          });
        });
        aList.sort(function (a, b) {
          return a.matnr.localeCompare(b.matnr);
        });
        return aList;
      },

      // 오더 생성 다이얼로그 열기
      onOpenApprovalDialog: function () {
        var oView = this.getView();

        // 기간 기본값: 자재 미선택 → 영업일 5일 (RP 자재 선택 시 당일로 재계산됨)
        var oPeriod = this._computeDefaultPeriod("");

        var oApprovalModel = new JSONModel({
          werks: "1000", // 플랜트 1000 고정
          autyp: "MS",
          matnr: "",
          maktx: "",
          gmein: "",
          sourceType: "", // 원천 유형 (R 수리 / S 판매)
          vbeln: "", // 요청 원천 번호
          posnr: "", // 아이템 번호
          dateFrom: oPeriod.from,
          dateTo: oPeriod.to,
          menge: "",
          materialListAll: [], // 전체 자재(자재마스터)
          materialList: [], // 오더종류 필터 적용된 표시용
        });
        oView.setModel(oApprovalModel, "approval");

        // 전체 자재 로드 후 오더종류 필터 적용
        this._loadMaterials();

        if (!this._oApprovalDialog) {
          this._oApprovalDialog = sap.ui.xmlfragment(
            "code.t4.ui5.pp01.view.ApprovalDialog",
            this,
          );
          oView.addDependent(this._oApprovalDialog);
        }
        this._oApprovalDialog.open();
      },

      // 자재 목록 로드 (자재마스터 OData / 준비 전엔 조회데이터에서 임시 추출)
      _loadMaterials: function () {
        var that = this;
        var oModel = this.getView().getModel("approval");

        // TODO(backend): 자재 CDS/OData 준비되면 bUseOData = true + 엔티티셋/필드 매핑 확인
        var bUseOData = false;
        var sEntitySet = "/ZCDS_D4_PP_MATERIAL"; // 실제 엔티티셋명으로 교체

        if (!bUseOData) {
          // 임시: 조회된 공정 데이터에서 자재 추출
          var aRaw =
            this.getView().getModel("view").getProperty("/rawOperations") || [];
          oModel.setProperty("/materialListAll", this._buildMaterialList(aRaw));
          this._applyMaterialFilter();
          return;
        }

        this.getOwnerComponent()
          .getModel()
          .read(sEntitySet, {
            urlParameters: {
              $filter: "Werks eq '1000'",
              $orderby: "Matnr asc",
            },
            success: function (oData) {
              var aList = (oData.results || []).map(function (m) {
                return {
                  matnr: m.Matnr,
                  maktx: m.Maktx || "",
                  gmein: m.Meins || m.Gmein || "",
                };
              });
              oModel.setProperty("/materialListAll", aList);
              that._applyMaterialFilter();
            },
            error: function () {
              MessageToast.show("자재 목록을 불러오지 못했습니다.");
            },
          });
      },

      // 오더종류에 따라 선택 가능한 자재 필터링
      _applyMaterialFilter: function () {
        var oModel = this.getView().getModel("approval");
        var sAutyp = oModel.getProperty("/autyp");
        var aAll = oModel.getProperty("/materialListAll") || [];

        var aFiltered = aAll.filter(function (m) {
          var bRp = /^RP/i.test(m.matnr);
          // 수리(RP): RP 로 시작하는 자재만 / 생산(MS)·긴급(UR): RP 가 아닌 자재만
          return sAutyp === "RP" ? bRp : !bRp;
        });
        oModel.setProperty("/materialList", aFiltered);

        // 현재 선택 자재가 필터에서 빠지면 초기화
        var sSel = oModel.getProperty("/matnr");
        var bStillValid = aFiltered.some(function (m) {
          return m.matnr === sSel;
        });
        if (!bStillValid) {
          oModel.setProperty("/matnr", "");
          oModel.setProperty("/maktx", "");
          oModel.setProperty("/gmein", "");
        }
      },

      // 오더종류 변경 시 자재 목록 재필터 + (선택 자재 기준) 기간 재계산
      onApprovalTypeChange: function () {
        this._applyMaterialFilter();
        this._applyPeriodByMaterial();
      },

      // ----- 요청원천번호 / 아이템번호 검색헬프 (ZCDS_D4_PP_0004) -----

      // 요청원천번호 F4 (오더 생성 다이얼로그)
      onVbelnValueHelp: function () {
        this._sVHContext = "approval";
        this._openSourceVH(false);
      },

      // 아이템번호 F4 (현재 입력된 요청원천번호로 필터)
      onPosnrValueHelp: function () {
        this._sVHContext = "approval";
        this._openSourceVH(true);
      },

      // 요청원천번호 F4 (조회 다이얼로그)
      onSearchVbelnVH: function () {
        this._sVHContext = "search";
        this._openSourceVH(false);
      },

      // 검색헬프 다이얼로그 열기
      _openSourceVH: function (bFilterByVbeln) {
        var that = this;
        var oApp = this.getView().getModel("approval");

        // 기본 필터: 아이템 F4는 현재 vbeln 으로 한정
        var aBase = [];
        if (bFilterByVbeln) {
          var sVbeln = oApp.getProperty("/vbeln");
          if (sVbeln) {
            aBase.push(new Filter("vbeln", FilterOperator.EQ, sVbeln));
          }
        }
        this._aSourceBaseFilters = aBase;

        this._loadSourceItems(function () {
          if (!that._oSourceVHDialog) {
            that._oSourceVHDialog = sap.ui.xmlfragment(
              "code.t4.ui5.pp01.view.SourceValueHelp",
              that,
            );
            that.getView().addDependent(that._oSourceVHDialog);
          }
          that._oSourceVHDialog.open();
          var oBinding = that._oSourceVHDialog.getBinding("items");
          if (oBinding) oBinding.filter(aBase);
        });
      },

      // 원천 목록 로드 (ZCDS_D4_PP_0004_CDS OData)
      _loadSourceItems: function (fnDone) {
        var oView = this.getView();
        var oVH = oView.getModel("vh");
        if (oVH && oVH.getProperty("/items")) {
          if (fnDone) fnDone();
          return;
        }

        // ZCDS_D4_PP_0004_CDS (@OData.publish) 의 source 모델에서 읽기
        this.getOwnerComponent()
          .getModel("source")
          .read("/ZCDS_D4_PP_0004", {
            success: function (oData) {
              oView.setModel(
                new JSONModel({ items: oData.results || [] }),
                "vh",
              );
              if (fnDone) fnDone();
            },
            error: function () {
              MessageToast.show("원천 목록을 불러오지 못했습니다.");
            },
          });
      },

      // 검색헬프 검색
      onSourceVHSearch: function (oEvent) {
        var sValue = oEvent.getParameter("value");
        var aFilters = (this._aSourceBaseFilters || []).slice();
        if (sValue) {
          aFilters.push(
            new Filter({
              filters: [
                new Filter("vbeln", FilterOperator.Contains, sValue),
                new Filter("posnr", FilterOperator.Contains, sValue),
                new Filter("matnr", FilterOperator.Contains, sValue),
                new Filter("maktx", FilterOperator.Contains, sValue),
              ],
              and: false,
            }),
          );
        }
        oEvent.getParameter("itemsBinding").filter(aFilters);
      },

      // 검색헬프 선택 → 자재/수량/기간 자동입력
      onSourceVHConfirm: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (oItem) {
          var oObj = oItem.getBindingContext("vh").getObject();
          if (this._sVHContext === "search") {
            // 조회 다이얼로그: 요청원천번호만 채움
            this.getView()
              .getModel("osearch")
              .setProperty("/vbeln", oObj.vbeln);
          } else {
            // 오더 생성 다이얼로그: 자재/수량 등 자동입력
            this._fillFromSource(oObj);
          }
        }
        var oBinding = this._oSourceVHDialog.getBinding("items");
        if (oBinding) oBinding.filter([]); // 다음 오픈 위해 초기화
      },

      onSourceVHCancel: function () {
        var oBinding = this._oSourceVHDialog.getBinding("items");
        if (oBinding) oBinding.filter([]);
      },

      // 선택한 원천 데이터로 입력값 자동 채우기
      _fillFromSource: function (obj) {
        var oApp = this.getView().getModel("approval");
        oApp.setProperty("/sourceType", obj.source_type || "");
        oApp.setProperty("/vbeln", obj.vbeln || "");
        oApp.setProperty("/posnr", obj.posnr || "");

        // 콤보박스 목록에 없는 자재면 추가 (자재코드가 표시되도록)
        if (obj.matnr) {
          this._ensureMaterial(obj.matnr, obj.maktx);
        }
        oApp.setProperty("/matnr", obj.matnr || "");
        oApp.setProperty("/maktx", obj.maktx || "");

        // RP 자재면 오더종류도 수리(RP)로 자동 변경
        if (/^RP/i.test(obj.matnr || "")) {
          oApp.setProperty("/autyp", "RP");
          this._applyMaterialFilter();
        }

        // 단위는 자재마스터에서 보강
        var aAll = oApp.getProperty("/materialListAll") || [];
        var oM = aAll.filter(function (m) {
          return m.matnr === obj.matnr;
        })[0];
        if (oM) oApp.setProperty("/gmein", oM.gmein);

        // 수량 자동입력: 수리(R)는 무조건 1, 그 외는 원천 수량(menge)
        if (obj.source_type === "R") {
          oApp.setProperty("/menge", "1");
        } else if (obj.menge != null && obj.menge !== "") {
          oApp.setProperty("/menge", obj.menge);
        }
        // 자재 기준으로 기간 재계산 (RP 자재면 당일)
        this._applyPeriodByMaterial();
      },

      // 자재가 콤보박스 목록(전체/표시)에 없으면 추가
      _ensureMaterial: function (sMatnr, sMaktx) {
        var oApp = this.getView().getModel("approval");
        ["/materialListAll", "/materialList"].forEach(function (sPath) {
          var aList = oApp.getProperty(sPath) || [];
          var bExists = aList.some(function (m) {
            return m.matnr === sMatnr;
          });
          if (!bExists) {
            aList = aList.concat([
              { matnr: sMatnr, maktx: sMaktx || "", gmein: "" },
            ]);
            oApp.setProperty(sPath, aList);
          }
        });
      },

      // 자재 선택 시 자재명/단위 자동 채우기
      onApprovalMaterialChange: function (oEvent) {
        var oModel = this.getView().getModel("approval");
        var oItem = oEvent.getParameter("selectedItem");
        var sMatnr = oItem ? oItem.getKey() : oModel.getProperty("/matnr");

        var aList = oModel.getProperty("/materialList") || [];
        var oFound = aList.filter(function (m) {
          return m.matnr === sMatnr;
        })[0];

        oModel.setProperty("/matnr", sMatnr);
        oModel.setProperty("/maktx", oFound ? oFound.maktx : "");
        oModel.setProperty("/gmein", oFound ? oFound.gmein : "");

        // 자재 바뀌면 기간 재계산 (RP 자재면 당일)
        this._applyPeriodByMaterial();
      },

      // 승인 신청 취소
      onApprovalCancel: function () {
        if (this._oApprovalDialog) {
          this._oApprovalDialog.close();
        }
      },

      // 승인 신청 제출 (검증 → 백엔드 액션 호출)
      onApprovalSubmit: function () {
        var oData = this.getView().getModel("approval").getData();

        // 필수값 검증
        if (
          !oData.autyp ||
          !oData.matnr ||
          !oData.dateFrom ||
          !oData.dateTo ||
          oData.menge === "" ||
          oData.menge == null
        ) {
          MessageToast.show("오더종류·자재·기간·수량을 모두 입력하세요.");
          return;
        }
        if (parseFloat(oData.menge) <= 0) {
          MessageToast.show("오더 수량은 0보다 커야 합니다.");
          return;
        }
        if (oData.dateFrom.getTime() > oData.dateTo.getTime()) {
          MessageToast.show("종료일은 시작일 이후여야 합니다.");
          return;
        }

        var oPayload = {
          Werks: oData.werks,
          Autyp: oData.autyp,
          Matnr: oData.matnr,
          Vbeln: oData.vbeln, // 요청 원천 번호
          PosnrSo: oData.posnr, // 아이템 번호
          Psmng: parseFloat(oData.menge),
          Gmein: oData.gmein,
          Gstrs: this._toYyyymmdd(oData.dateFrom), // 생산 시작 예정일
          Gltrs: this._toYyyymmdd(oData.dateTo), // 생산 완료 예정일
        };

        // 생성 전 확인 메시지박스 (오더 종류별 분기)
        var that = this;
        var mTypeLabel = { MS: "생산", UR: "긴급", RP: "수리" };
        var sTypeLabel = mTypeLabel[oData.autyp];
        var sMsg;
        if (sTypeLabel) {
          // 생산/긴급/수리: 생성과 동시에 생산 승인
          sMsg =
            sTypeLabel +
            "오더가 생성되며, 생산이 승인됩니다.\n\n" +
            "오더를 생성하시겠습니까?\n이 과정은 취소할 수 없습니다.";
        } else {
          // 계획오더: 담당자의 생산 승인 후 생산 시작
          sMsg =
            "계획오더가 생성되며, 담당자의 생산 승인 시 생산이 시작됩니다.\n\n" +
            "오더를 생성하시겠습니까?";
        }

        MessageBox.confirm(sMsg, {
          title: "오더 생성 확인",
          actions: ["확인", "취소"],
          emphasizedAction: "확인",
          onClose: function (sAction) {
            if (sAction === "확인") {
              that._submitApproval(oPayload);
            }
          },
        });
      },

      // 승인 처리: 백엔드 ApproveProductionOrder Function Import 호출
      // (부하 체크 ZTD4PP0012 · 채번 ZFD4PP0002 · INSERT ZTD4PP0008 는 백엔드 책임)
      _submitApproval: function (oPayload) {
        var that = this;

        // ZGWD4PP0003_SRV / ApproveProductionOrder 호출
        this._getApproveModel().callFunction("/ApproveProductionOrder", {
          method: "POST",
          urlParameters: oPayload,
          success: function (oResult) {
            var r =
              oResult && oResult.ApproveProductionOrder
                ? oResult.ApproveProductionOrder
                : oResult;
            that._afterApprove(!!r.Success, r.Aufnr, r.Message);
          },
          error: function (oErr) {
            var sMsg = "승인 처리 중 오류가 발생했습니다.";
            try {
              var oResp = JSON.parse(oErr.responseText);
              if (oResp.error && oResp.error.message) {
                sMsg = oResp.error.message.value || sMsg;
              }
            } catch (e) {
              if (oErr && oErr.message) sMsg = oErr.message;
            }
            that._afterApprove(false, "", sMsg);
          },
        });
      },

      // 오더 생성 액션용 OData 모델 (지연 생성)
      // TODO(backend): 등록된 실제 서비스명 확인 (보통 ZGWD4PP0003_SRV)
      _getApproveModel: function () {
        if (!this._oApproveModel) {
          this._oApproveModel = new ODataModel(
            "/sap/opu/odata/sap/ZGWD4PP0003_SRV/",
            { useBatch: false },
          );
        }
        return this._oApproveModel;
      },

      // 자재코드 기준 기본 생산 계획 기간 계산
      // - RP 자재(RP*): 당일 (오늘 ~ 오늘)
      // - 그 외: 영업일 5일 (주말 제외, 시작일 포함)
      _computeDefaultPeriod: function (sMatnr) {
        var oToday = new Date();
        oToday.setHours(0, 0, 0, 0);

        if (/^RP/i.test(sMatnr || "")) {
          return { from: oToday, to: new Date(oToday.getTime()) };
        }

        var oFrom = this._nextBusinessDay(oToday); // 주말이면 다음 영업일로
        var oTo = this._addBusinessDays(oFrom, 4); // 시작일 포함 5영업일
        return { from: oFrom, to: oTo };
      },

      // 현재 선택된 자재코드 기준으로 기간 재계산/설정
      _applyPeriodByMaterial: function () {
        var oApp = this.getView().getModel("approval");
        var oPeriod = this._computeDefaultPeriod(oApp.getProperty("/matnr"));
        oApp.setProperty("/dateFrom", oPeriod.from);
        oApp.setProperty("/dateTo", oPeriod.to);
      },

      // 주말이면 다음 영업일(월요일)로 이동
      _nextBusinessDay: function (oDate) {
        var o = new Date(oDate.getTime());
        while (o.getDay() === 0 || o.getDay() === 6) {
          o.setDate(o.getDate() + 1);
        }
        return o;
      },

      // 영업일(주말 제외) n일 더하기
      _addBusinessDays: function (oDate, nDays) {
        var o = new Date(oDate.getTime());
        var nAdded = 0;
        while (nAdded < nDays) {
          o.setDate(o.getDate() + 1);
          if (o.getDay() !== 0 && o.getDay() !== 6) nAdded++;
        }
        return o;
      },

      // Date → "YYYYMMDD" 문자열 (DATS 전송용)
      _toYyyymmdd: function (oDate) {
        if (!oDate) return "";
        var y = oDate.getFullYear();
        var m = oDate.getMonth() + 1;
        var d = oDate.getDate();
        return "" + y + (m < 10 ? "0" + m : m) + (d < 10 ? "0" + d : d);
      },

      // 승인 결과 처리
      _afterApprove: function (bSuccess, sAufnr, sMessage) {
        var that = this;
        if (bSuccess) {
          MessageBox.success(
            (sMessage || "오더가 생성되었습니다.") +
              "\n생산오더번호: " +
              sAufnr,
            {
              title: "오더 생성 완료",
              onClose: function () {
                if (that._oApprovalDialog) {
                  that._oApprovalDialog.close();
                }
                that._loadOperationsData();
              },
            },
          );
        } else {
          MessageBox.warning(
            sMessage || "부하 초과로 오더를 생성할 수 없습니다.",
            {
              title: "오더 생성 불가",
            },
          );
        }
      },

      // 일자별로 공정 그룹화 (캘린더 칩 단위)
      _groupByDate: function (aFiltered) {
        var aGrouped = [];
        var oIdxMap = {};

        for (var i = 0; i < aFiltered.length; i++) {
          var oItem = aFiltered[i];
          var sDate = this._formatDate(oItem.Gstrs);

          var nIdx = oIdxMap[sDate];
          if (nIdx === undefined) {
            var dStart = new Date(oItem.Gstrs);
            dStart.setHours(8, 0, 0, 0);
            var dEnd = new Date(oItem.Gstrs);
            dEnd.setHours(17, 0, 0, 0);

            aGrouped.push({
              date: sDate,
              startDate: dStart,
              endDate: dEnd,
              count: 0,
              runCount: 0,
              doneCount: 0,
              schdCount: 0,
              earlyDoneCount: 0,
              arbplSet: {},
              operations: [],
            });
            nIdx = aGrouped.length - 1;
            oIdxMap[sDate] = nIdx;
          }

          var g = aGrouped[nIdx];
          g.count++;
          g.operations.push(oItem);
          g.arbplSet[oItem.Arbpl] = true;

          if (oItem._earlyDone) g.earlyDoneCount++;
          else if (oItem.Statu === "DONE") g.doneCount++;
          else if (oItem.Statu === "RUN") g.runCount++;
          else if (oItem.Statu === "SCHD") g.schdCount++;
        }

        // 그룹별 표시 정보 만들기
        for (var k = 0; k < aGrouped.length; k++) {
          var g = aGrouped[k];
          var aArbpl = Object.keys(g.arbplSet);

          var sLabel;
          if (aArbpl.length === 1) {
            sLabel = aArbpl[0];
          } else {
            sLabel = "작업장 " + aArbpl.length + "개";
          }

          var sFullText =
            "완료 " +
            g.doneCount +
            " · 진행 " +
            g.runCount +
            " · 계획 " +
            g.schdCount;
          if (g.earlyDoneCount > 0) {
            sFullText += " · 조기마감 " + g.earlyDoneCount;
          }
          g.tooltip = sFullText;

          // 폰에선 칸이 좁으니 "N건"만, 그 외엔 상세
          if (sap.ui.Device.system.phone) {
            g.title = g.count + "건";
            g.text = "";
          } else {
            g.title = sLabel + " · " + g.count + "건";
            g.text = sFullText;
          }

          if (g.runCount > 0) g.type = "Type07";
          else if (g.schdCount > 0) g.type = "Type10";
          else g.type = "Type01";

          // 그 날 공정이 전부 조기마감이면 회색으로 표시
          if (g.count > 0 && g.earlyDoneCount === g.count) {
            g.color = "#9e9e9e";
          }
        }

        return aGrouped;
      },

      // ============================================================
      // 이벤트 핸들러
      // ============================================================

      // 작업장/상태 필터 변경 시 캘린더 갱신
      onFilterChange: function () {
        var oViewModel = this.getView().getModel("view");
        var aRaw = oViewModel.getProperty("/rawOperations");
        var sArbpl = oViewModel.getProperty("/selectedArbpl");
        var sStatu = oViewModel.getProperty("/selectedStatu");

        var aFiltered = [];
        for (var i = 0; i < aRaw.length; i++) {
          var oItem = aRaw[i];
          if (!oItem.Gstrs) continue;
          if (sArbpl !== "" && oItem.Arbpl !== sArbpl) continue;
          if (sStatu !== "ALL" && oItem.Statu !== sStatu) continue;
          aFiltered.push(oItem);
        }

        var aGrouped = this._groupByDate(aFiltered);
        oViewModel.setProperty("/filteredOperations", aGrouped);
      },

      // 캘린더 월 이동
      onCalendarDateChange: function (oEvent) {
        // 필요 시 추가 로직
      },

      // 새로고침 (ABAP 등 외부 변경분 다시 로드)
      onRefresh: function () {
        this._loadOperationsData();
        MessageToast.show("새로고침되었습니다.");
      },

      // 캘린더 칩 클릭 - 워크센터별 그룹화 팝업
      onAppointmentPress: function (oEvent) {
        var oAppointment = oEvent.getParameter("appointment");
        if (!oAppointment) return;

        var oContext = oAppointment.getBindingContext("view");
        var oData = oContext.getObject();

        // 워크센터별 그룹화
        var oWcGroups = {};
        oData.operations.forEach(function (op) {
          var sArbpl = op.Arbpl;
          if (!oWcGroups[sArbpl]) {
            oWcGroups[sArbpl] = {
              arbpl: sArbpl,
              ktext: op.ktext || op.Ktext || sArbpl,
              count: 0,
              runCount: 0,
              doneCount: 0,
              schdCount: 0,
              operations: [],
              expanded: false,
            };
          }
          var g = oWcGroups[sArbpl];
          g.operations.push(op);
          g.count++;
          if (op.Statu === "DONE") g.doneCount++;
          else if (op.Statu === "RUN") g.runCount++;
          else if (op.Statu === "SCHD") g.schdCount++;
        });

        var aWorkCenters = Object.values(oWcGroups).sort(function (a, b) {
          return a.arbpl.localeCompare(b.arbpl);
        });

        // 오더 타입별 unique 오더 카운트
        var oOrderTypeMap = { MS: {}, UR: {}, RP: {}, PL: {} };
        oData.operations.forEach(function (op) {
          var sAutyp = op.Autyp || "MS";
          if (oOrderTypeMap[sAutyp]) {
            oOrderTypeMap[sAutyp][op.Aufnr] = true;
          }
        });

        var oOrderStats = {
          msCnt: Object.keys(oOrderTypeMap.MS).length,
          urCnt: Object.keys(oOrderTypeMap.UR).length,
          rpCnt: Object.keys(oOrderTypeMap.RP).length,
          plCnt: Object.keys(oOrderTypeMap.PL).length,
        };
        oOrderStats.totalCnt =
          oOrderStats.msCnt +
          oOrderStats.urCnt +
          oOrderStats.rpCnt +
          oOrderStats.plCnt;

        var oSelectedData = Object.assign({}, oData, {
          workCenters: aWorkCenters,
          orderStats: oOrderStats,
        });
        this.getView()
          .getModel("view")
          .setProperty("/selectedGroup", oSelectedData);

        if (!this._oDetailDialog) {
          this._oDetailDialog = sap.ui.xmlfragment(
            "code.t4.ui5.pp01.view.DetailPopover",
            this,
          );
          this.getView().addDependent(this._oDetailDialog);
        }
        this._oDetailDialog.open();
      },

      // 오더 행 클릭 - 상세 페이지 이동
      onOrderPress: function (oEvent) {
        var oContext = oEvent.getSource().getBindingContext("view");
        var oData = oContext.getObject();

        if (this._oDetailDialog) {
          this._oDetailDialog.close();
        }

        var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
        oRouter.navTo("RouteOrderDetail", {
          aufnr: oData.Aufnr,
          plnnr: oData.Plnnr,
          vornr: oData.Vornr,
        });
      },

      // 팝업 닫기
      onCloseDetailPopover: function () {
        if (this._oDetailDialog) {
          this._oDetailDialog.close();
        }
      },

      // ============================================================
      // 생산오더 조회 (자재코드/오더번호/요청원천번호/생산상태)
      // ============================================================

      onOpenOrderSearch: function () {
        var oView = this.getView();
        oView.setModel(
          new JSONModel({
            aufnr: "",
            matnr: "",
            vbeln: "",
            statu: "",
            results: [],
          }),
          "osearch",
        );

        if (!this._oOrderSearchDialog) {
          this._oOrderSearchDialog = sap.ui.xmlfragment(
            "code.t4.ui5.pp01.view.OrderSearchDialog",
            this,
          );
          oView.addDependent(this._oOrderSearchDialog);
        }
        this._oOrderSearchDialog.open();
      },

      onOrderSearchGo: function () {
        var that = this;
        var oModel = this.getView().getModel("osearch");
        var oCond = oModel.getData();

        // TODO(backend): ZCDS_D4_PP_0003(생산오더 Search Help) OData 노출되면 bUseOData = true
        // 현재는 이미 로드된 공정 데이터(rawOperations)에서 전체 오더를 조회
        var bUseOData = false;
        var sEntitySet = "/ZCDS_D4_PP_0003";

        if (!bUseOData) {
          var aRes = this._getAllOrders().filter(function (o) {
            if (oCond.aufnr && o.aufnr.indexOf(oCond.aufnr) < 0) return false;
            if (oCond.matnr && o.matnr.indexOf(oCond.matnr) < 0) return false;
            if (oCond.vbeln && (o.vbeln || "").indexOf(oCond.vbeln) < 0)
              return false;
            if (oCond.statu && o.statu !== oCond.statu) return false;
            return true;
          });
          oModel.setProperty("/results", aRes);
          if (aRes.length === 0) MessageToast.show("조회 결과가 없습니다.");
          return;
        }

        // 실연동: OData $filter
        var aFilters = [];
        if (oCond.aufnr)
          aFilters.push(
            new Filter("aufnr", FilterOperator.Contains, oCond.aufnr),
          );
        if (oCond.matnr)
          aFilters.push(
            new Filter("matnr", FilterOperator.Contains, oCond.matnr),
          );
        if (oCond.vbeln)
          aFilters.push(
            new Filter("vbeln", FilterOperator.Contains, oCond.vbeln),
          );
        if (oCond.statu)
          aFilters.push(new Filter("statu", FilterOperator.EQ, oCond.statu));

        this._getOrderModel().read(sEntitySet, {
          filters: aFilters,
          success: function (oData) {
            var aRes = (oData.results || []).map(function (o) {
              return {
                aufnr: o.aufnr,
                matnr: o.matnr,
                maktx: o.maktx,
                vbeln: o.vbeln,
                psmng: o.psmng,
                gmein: o.gmein,
                statu: o.statu,
                plnnr: o.plnnr,
                vornr: o.vornr,
              };
            });
            oModel.setProperty("/results", aRes);
            if (aRes.length === 0) MessageToast.show("조회 결과가 없습니다.");
          },
          error: function () {
            MessageToast.show("조회 중 오류가 발생했습니다.");
          },
        });
      },

      // 조회 결과 행 클릭 → 오더 상세로 이동
      onOrderSearchRowPress: function (oEvent) {
        var o = oEvent.getSource().getBindingContext("osearch").getObject();
        if (this._oOrderSearchDialog) this._oOrderSearchDialog.close();

        var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
        oRouter.navTo("RouteOrderDetail", {
          aufnr: o.aufnr,
          plnnr: o.plnnr || "0",
          vornr: o.vornr || "0",
        });
      },

      onOrderSearchClose: function () {
        if (this._oOrderSearchDialog) this._oOrderSearchDialog.close();
      },

      // 조회 액션용 OData 모델 (지연 생성)
      // TODO(backend): ZCDS_D4_PP_0003 노출 서비스명으로 URL 교체
      _getOrderModel: function () {
        if (!this._oOrderModel) {
          this._oOrderModel = new ODataModel(
            "/sap/opu/odata/sap/ZCDS_D4_PP_0003_CDS/",
            { useBatch: false },
          );
        }
        return this._oOrderModel;
      },

      // 이미 로드된 공정 데이터(rawOperations)에서 전체 오더 목록 생성 (오더번호 기준 중복 제거)
      _getAllOrders: function () {
        var aRaw =
          this.getView().getModel("view").getProperty("/rawOperations") || [];
        var oSeen = {};
        var aOrders = [];
        aRaw.forEach(function (op) {
          if (!op.Aufnr || oSeen[op.Aufnr]) return;
          oSeen[op.Aufnr] = true;
          aOrders.push({
            aufnr: op.Aufnr,
            matnr: op.Matnr,
            maktx: op.Maktx,
            vbeln: op.Vbeln || "",
            psmng: op.order_qty,
            gmein: op.Gmein,
            statu: op.Statu,
            plnnr: op.Plnnr,
            vornr: op.Vornr,
          });
        });
        return aOrders;
      },

      // ----- 조회 조건 F4: 자재코드 -----
      onSearchMatnrVH: function () {
        var oView = this.getView();
        if (!oView.getModel("matvh")) {
          var aRaw = oView.getModel("view").getProperty("/rawOperations") || [];
          oView.setModel(
            new JSONModel({ items: this._buildMaterialList(aRaw) }),
            "matvh",
          );
        }
        if (!this._oMatVHDialog) {
          this._oMatVHDialog = sap.ui.xmlfragment(
            "code.t4.ui5.pp01.view.MaterialValueHelp",
            this,
          );
          oView.addDependent(this._oMatVHDialog);
        }
        this._oMatVHDialog.open();
      },

      onMaterialVHSearch: function (oEvent) {
        var sValue = oEvent.getParameter("value");
        var aFilters = [];
        if (sValue) {
          aFilters.push(
            new Filter({
              filters: [
                new Filter("matnr", FilterOperator.Contains, sValue),
                new Filter("maktx", FilterOperator.Contains, sValue),
              ],
              and: false,
            }),
          );
        }
        oEvent.getParameter("itemsBinding").filter(aFilters);
      },

      onMaterialVHConfirm: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (oItem) {
          this.getView()
            .getModel("osearch")
            .setProperty(
              "/matnr",
              oItem.getBindingContext("matvh").getObject().matnr,
            );
        }
      },

      // ----- 조회 조건 F4: 생산오더번호 -----
      onSearchAufnrVH: function () {
        var oView = this.getView();
        // 매번 최신 전체 오더로 갱신
        oView.setModel(
          new JSONModel({ items: this._getAllOrders() }),
          "ordervh",
        );
        if (!this._oOrderVHDialog) {
          this._oOrderVHDialog = sap.ui.xmlfragment(
            "code.t4.ui5.pp01.view.OrderValueHelp",
            this,
          );
          oView.addDependent(this._oOrderVHDialog);
        }
        this._oOrderVHDialog.open();
      },

      onOrderVHSearch: function (oEvent) {
        var sValue = oEvent.getParameter("value");
        var aFilters = [];
        if (sValue) {
          aFilters.push(
            new Filter({
              filters: [
                new Filter("aufnr", FilterOperator.Contains, sValue),
                new Filter("matnr", FilterOperator.Contains, sValue),
                new Filter("maktx", FilterOperator.Contains, sValue),
              ],
              and: false,
            }),
          );
        }
        oEvent.getParameter("itemsBinding").filter(aFilters);
      },

      onOrderVHConfirm: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (oItem) {
          this.getView()
            .getModel("osearch")
            .setProperty(
              "/aufnr",
              oItem.getBindingContext("ordervh").getObject().aufnr,
            );
        }
      },

      // ============================================================
      // 유틸
      // ============================================================

      // Date 객체를 YYYY-MM-DD 문자열로 변환
      _formatDate: function (oDate) {
        if (!oDate) return "";
        var nMonth = oDate.getMonth() + 1;
        var nDay = oDate.getDate();
        var sMonth = nMonth < 10 ? "0" + nMonth : "" + nMonth;
        var sDay = nDay < 10 ? "0" + nDay : "" + nDay;
        return oDate.getFullYear() + "-" + sMonth + "-" + sDay;
      },
    });
  },
);
