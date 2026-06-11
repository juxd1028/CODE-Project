sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("code.t4.ui5.pp01.controller.OrderDetail", {

        onInit: function () {
            this.getView().setModel(new JSONModel({}), "view");

            // 라우트 매치 시 파라미터 받기
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RouteOrderDetail")
                   .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");

            this.getView().getModel("view").setData({
                aufnr: oArgs.aufnr,
                plnnr: oArgs.plnnr,
                vornr: oArgs.vornr
            });

            console.log("OrderDetail 진입:", oArgs);
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("RouteMain");
        }

    });
});