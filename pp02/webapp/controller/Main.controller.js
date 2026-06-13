sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
  ],
  (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    SelectDialog,
    StandardListItem,
  ) => {
    "use strict";

    return Controller.extend("code.t4.ui5.pp02.controller.Main", {
      onInit() {
        var oSearchModel = new JSONModel({
          orderNo: "",
          materialCode: "",
          dateFrom: null,
          dateTo: null,
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
          urlParameters: {
            $top: "1000",
          },
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

      onOrderNoValueHelp() {
        this._openSearchHelpDialog("orderNo", "Aufnr", "생산오더번호");
      },

      onMaterialCodeValueHelp() {
        this._openSearchHelpDialog("materialCode", "matnr", "자재코드");
      },

      _openSearchHelpDialog(sField, sProperty, sTitle) {
        this._sSearchHelpField = sField;
        this._sSearchHelpProperty = sProperty;
        this._sSearchHelpTitle = sTitle;

        if (!this._oSearchHelpDialog) {
          this._oSearchHelpDialog = new SelectDialog({
            title: sTitle,
            supportMultiselect: false,
            search: this._onSearchHelpSearch.bind(this),
            confirm: this._onSearchHelpConfirm.bind(this),
            cancel: this._onSearchHelpCancel.bind(this),
          });

          this.getView().addDependent(this._oSearchHelpDialog);
          this._oSearchHelpDialog.bindAggregation("items", {
            path: "searchHelp>/items",
            template: new StandardListItem({
              title: "{searchHelp>value}",
              description: "{searchHelp>description}",
            }),
          });
        } else {
          this._oSearchHelpDialog.setTitle(sTitle);
        }

        this._loadSearchHelpItems(sProperty);
        this._oSearchHelpDialog.open();
      },

      _loadSearchHelpItems(sProperty) {
        var oODataModel = this.getOwnerComponent().getModel();
        var oSearchHelpModel = this.getView().getModel("searchHelp");
        var sSelect = sProperty;

        if (!oSearchHelpModel) {
          oSearchHelpModel = new JSONModel({ items: [] });
          this.getView().setModel(oSearchHelpModel, "searchHelp");
        }

        if (sProperty === "Aufnr") {
          sSelect += ",matnr,Maktx";
        } else if (sProperty === "matnr") {
          sSelect += ",Maktx";
        }

        oODataModel.read("/ZCDS_D4_PP_0012", {
          urlParameters: {
            $select: sSelect,
            $top: "1000",
            $orderby: sProperty,
          },
          success: function (oData) {
            var aItems = (oData.results || [])
              .map(function (oEntry) {
                var sValue = oEntry[sProperty] || "";
                var sDescription = "";

                if (sProperty === "Aufnr") {
                  sDescription = [oEntry.matnr, oEntry.Maktx]
                    .filter(function (sText) {
                      return sText;
                    })
                    .join(" ");
                } else if (sProperty === "matnr") {
                  sDescription = oEntry.Maktx || "";
                }

                return {
                  value: sValue,
                  description: sDescription,
                };
              })
              .filter(function (oItem, i, aSelf) {
                return (
                  oItem.value &&
                  aSelf.findIndex(function (oOther) {
                    return oOther.value === oItem.value;
                  }) === i
                );
              })
              .sort(function (a, b) {
                return a.value.localeCompare(b.value);
              });

            oSearchHelpModel.setData({ items: aItems });
          },
          error: function () {
            oSearchHelpModel.setData({ items: [] });
          },
        });
      },

      _onSearchHelpSearch(oEvent) {
        var sValue = oEvent.getParameter("value");
        var oBinding = oEvent.getSource().getBinding("items");
        oBinding.filter(
          sValue ? [new Filter("value", FilterOperator.Contains, sValue)] : [],
        );
      },

      _onSearchHelpConfirm(oEvent) {
        var oSelectedItem = oEvent.getParameter("selectedItem");
        if (oSelectedItem) {
          var sValue = oSelectedItem.getTitle();
          this.getView()
            .getModel("search")
            .setProperty("/" + this._sSearchHelpField, sValue);
        }
      },

      _onSearchHelpCancel() {
        if (this._oSearchHelpDialog) {
          this._oSearchHelpDialog.close();
        }
      },

      _flattenMaterials(aResults, oSearch) {
        return aResults
          .filter(function (oEntry) {
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
            var sUnit = oEntry.Meins || oEntry.Gmein || "";
            var sRawInventory = oEntry.Labst != null ? oEntry.Labst : "";
            var sInventoryText = sRawInventory + (sUnit ? " " + sUnit : "");
            var bShortage = fInventory < fRequiredQuantity;
            var sProcessNo = oEntry.Vornr || "";
            var sProcessName = oEntry.ltxa1 || "공정명 없음";
            var sGroupKey = sProcessNo.toString();
            var sGroupLabel =
              (sProcessNo ? "공정 " + sProcessNo + " / " : "") + sProcessName;

            var sRequiredQuantityText =
              (oEntry.Bemng != null ? oEntry.Bemng : "") +
              (sUnit ? " " + sUnit : "");

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
              BemngText: sRequiredQuantityText,
              Labst: fInventory,
              LabstText: sInventoryText,
              Status: oEntry.Status || "",
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
