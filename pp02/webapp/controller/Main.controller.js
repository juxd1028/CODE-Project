sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
  ],
  (Controller, JSONModel, Filter, FilterOperator, Sorter) => {
    "use strict";

    return Controller.extend("code.t4.ui5.pp02.controller.Main", {
      onInit() {
        var oSearchModel = new JSONModel({
          orderNo: "",
          materialCode: "",
          dateFrom: null,
          dateTo: null,
          status: "ALL",
          createdBy: "",
        });

        var oResultModel = new JSONModel({
          orderId: "",
          summaryText: "",
          materials: [],
          groups: [],
        });

        this.getView().setModel(oSearchModel, "search");
        this.getView().setModel(oResultModel, "result");
      },

      onSearch() {
        var oSearch = this.getView().getModel("search").getData();
        var oODataModel = this.getOwnerComponent().getModel();
        var oResultModel = this.getView().getModel("result");
        var aFilters = [];

        if (oSearch.orderNo) {
          aFilters.push(
            new Filter("Aufnr", FilterOperator.Contains, oSearch.orderNo),
          );
        }
        if (oSearch.materialCode) {
          aFilters.push(
            new Filter("matnr", FilterOperator.Contains, oSearch.materialCode),
          );
        }

        if (!oODataModel) {
          console.error("OData model not found on component");
          return;
        }

        oODataModel.read("/ZCDS_D4_PP_0012", {
          filters: aFilters,
          success: function (oData) {
            var aResults = oData.results || [];
            var aMaterials = this._flattenMaterials(aResults, oSearch);
            var iTotal = aMaterials.length;

            oResultModel.setData({
              orderId: oSearch.orderNo || "",
              summaryText: oSearch.orderNo
                ? "오더 " + oSearch.orderNo + " 조회 결과 총 " + iTotal + "건"
                : "총 " + iTotal + "건",
              materials: aMaterials,
              groups: this._groupByProcess(aMaterials),
            });
          }.bind(this),
          error: function () {
            oResultModel.setData({
              orderId: oSearch.orderNo || "",
              summaryText: "조회 중 오류가 발생했습니다.",
              groups: [],
            });
          },
        });
      },

      _flattenMaterials(aResults, oSearch) {
        return aResults
          .filter(function (oEntry) {
            if (oSearch.status && oSearch.status !== "ALL") {
              var sStatus = oEntry.Status || "";
              if (sStatus !== oSearch.status) {
                return false;
              }
            }
            if (oSearch.createdBy) {
              var sCreatedBy = oEntry.Cuserid || "";
              if (sCreatedBy.indexOf(oSearch.createdBy) === -1) {
                return false;
              }
            }
            if (oSearch.dateFrom && oSearch.dateTo) {
              var sCreatedDate = oEntry.CreatedAt || oEntry.CreatedDate || null;
              if (sCreatedDate) {
                var dCreatedDate = new Date(sCreatedDate);
                if (
                  dCreatedDate < oSearch.dateFrom ||
                  dCreatedDate > oSearch.dateTo
                ) {
                  return false;
                }
              }
            }
            return true;
          })
          .map(function (oEntry) {
            var fRequiredQuantity = parseFloat(oEntry.Bemng) || 0;
            var fInventory = parseFloat(oEntry.Labst) || 0;
            var bShortage = fInventory < fRequiredQuantity;
            var sProcessNo = oEntry.Vornr || "";
            var sProcessName = oEntry.ltxa1 || "공정명 없음";
            var sGroupKey = sProcessNo.toString();
            var sGroupLabel =
              (sProcessNo ? "공정 " + sProcessNo + " / " : "") + sProcessName;

            return {
              groupKey: sGroupKey,
              groupLabel: sGroupLabel,
              Aufnr: oEntry.Aufnr || "",
              Vornr: oEntry.Vornr || "",
              ltxa1: sProcessName,
              matnr: oEntry.matnr,
              Maktx: oEntry.Maktx || "",
              Lgort: oEntry.Lgort || "",
              Lgobe: oEntry.Lgobe || oEntry.Lgort || "",
              Bemng: fRequiredQuantity,
              Labst: fInventory,
              Status: oEntry.Status || "",
              Cuserid: oEntry.Cuserid || "",
              statusText: bShortage ? "부족" : "완료",
              statusState: bShortage ? "Error" : "Success",
            };
          });
      },

      _groupByProcess(aMaterials) {
        var oGroups = {};
        aMaterials.forEach(function (oMaterial) {
          var sKey = oMaterial.groupKey || "unknown";
          if (!oGroups[sKey]) {
            oGroups[sKey] = {
              groupKey: sKey,
              groupLabel: oMaterial.groupLabel || "공정 정보 없음",
              expanded: false,
              items: [],
            };
          }
          oGroups[sKey].items.push(oMaterial);
        });
        return Object.keys(oGroups)
          .sort()
          .map(function (sKey) {
            return oGroups[sKey];
          });
      },
    });
  },
);
