import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {_t} from "@web/core/l10n/translation";
import {patch} from "@web/core/utils/patch";

patch(PickingScreen.prototype, {
    async backToDraft() {
        if (this.state.picking?.state !== "cancel") {
            return;
        }
        this.dialog.add(ConfirmationDialog, {
            title: _t("Confirm back to draft"),
            body: _t("Are you sure you want to return this operation to draft?"),
            confirm: async () => {
                try {
                    await this.inventory.call("stock.picking", "action_back_to_draft", [
                        [this.pickingId],
                    ]);
                    this.inventory.notify(_t("Picking returned to draft."), {
                        type: "success",
                    });
                    this.store.navigate("picking_list", this.listParams || {}, {
                        clearHistory: true,
                    });
                } catch (error) {
                    this.inventory.notify(
                        _t("Back to draft error: %(error)s", {error}),
                        {type: "error"}
                    );
                }
            },
        });
    },
});
