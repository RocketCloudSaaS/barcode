import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";

/**
 * Quality tab of a reception: lists the quality inspections that the reception
 * generated (via quality_control_stock_oca), lets the operator answer each one
 * and, when a check does not pass, attach a photo as evidence.
 */
export class QualityTab extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.state = useState({
            inspections: [],
            answers: {},
            loading: true,
            busyId: null,
        });

        onWillStart(async () => {
            await this.loadInspections();
        });
    }

    async loadInspections() {
        this.state.loading = true;
        try {
            const result = await this.inventory.call(
                "stock.picking",
                "action_barcode_scanner_quality_inspections",
                [this.props.pickingId]
            );
            this.state.inspections = result.inspections;
        } catch (error) {
            this.notifyError(error, _t("Could not load the inspections."));
        } finally {
            this.state.loading = false;
        }
    }

    answersFor(inspection) {
        if (!this.state.answers[inspection.inspection_id]) {
            this.state.answers[inspection.inspection_id] = {};
        }
        return this.state.answers[inspection.inspection_id];
    }

    setQualitative(inspection, line, valueId) {
        this.answersFor(inspection)[line.id] = {
            line_id: line.id,
            qualitative_value_id: valueId,
        };
    }

    onQuantitative(inspection, line, ev) {
        const value = parseFloat(ev.target.value);
        this.answersFor(inspection)[line.id] = {
            line_id: line.id,
            quantitative_value: isNaN(value) ? 0 : value,
        };
    }

    isChosen(inspection, line, valueId) {
        return this.answersFor(inspection)[line.id]?.qualitative_value_id === valueId;
    }

    isEditable(inspection) {
        return inspection.state === "ready" || inspection.state === "waiting";
    }

    allAnswered(inspection) {
        return inspection.lines.every((line) => {
            const answer = this.answersFor(inspection)[line.id];
            if (line.question_type === "qualitative") {
                return Boolean(answer?.qualitative_value_id);
            }
            return answer && answer.quantitative_value !== undefined;
        });
    }

    async submit(inspection) {
        if (this.state.busyId || !this.allAnswered(inspection)) {
            return;
        }
        this.state.busyId = inspection.inspection_id;
        try {
            const answers = Object.values(this.answersFor(inspection));
            const updated = await this.inventory.call(
                "qc.inspection",
                "action_barcode_scanner_submit",
                [inspection.inspection_id, answers]
            );
            this.replaceInspection(updated);
            this.inventory.notify(
                updated.success
                    ? _t("Inspection %(name)s passed.", {name: updated.inspection_name})
                    : _t("Inspection %(name)s failed.", {
                          name: updated.inspection_name,
                      }),
                {type: updated.success ? "success" : "warning"}
            );
        } catch (error) {
            this.notifyError(error, _t("Could not submit the inspection."));
        } finally {
            this.state.busyId = null;
        }
    }

    async onPhotoSelected(inspection, ev) {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) {
            return;
        }
        this.state.busyId = inspection.inspection_id;
        try {
            const photo = await this.readPhoto(file);
            const result = await this.inventory.call(
                "qc.inspection",
                "action_barcode_scanner_attach_photo",
                [inspection.inspection_id, photo.name, photo.datas]
            );
            inspection.photo_count = result.photo_count;
            this.inventory.notify(_t("Photo attached."), {type: "success"});
        } catch (error) {
            this.notifyError(error, _t("Could not attach the photo."));
        } finally {
            this.state.busyId = null;
        }
    }

    // Read the chosen photo, shrinking it to a reasonable evidence size. Phone
    // cameras produce multi-megapixel images whose upload a reverse proxy may
    // reject as too large, so the picture is scaled down (longest side capped)
    // and re-encoded as JPEG. Non-images, or a browser without canvas support,
    // keep the untouched file.
    async readPhoto(file, maxSide = 1600, quality = 0.82) {
        if (file.type && file.type.startsWith("image/")) {
            try {
                const bitmap = await createImageBitmap(file, {
                    imageOrientation: "from-image",
                });
                const scale = Math.min(
                    1,
                    maxSide / Math.max(bitmap.width, bitmap.height)
                );
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext("2d");
                if (context) {
                    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                    bitmap.close();
                    const datas = canvas.toDataURL("image/jpeg", quality).split(",")[1];
                    if (datas) {
                        const name = file.name.replace(/\.[^./\\]+$/, "") + ".jpg";
                        return {name, datas};
                    }
                } else {
                    bitmap.close();
                }
            } catch {
                // A browser without createImageBitmap/canvas keeps the raw file.
            }
        }
        return {name: file.name, datas: await this.readAsBase64(file)};
    }

    readAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1] || "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    replaceInspection(updated) {
        const index = this.state.inspections.findIndex(
            (i) => i.inspection_id === updated.inspection_id
        );
        if (index !== -1) {
            this.state.inspections[index] = {
                ...updated,
                photo_count: this.state.inspections[index].photo_count,
            };
        }
    }

    notifyError(error, fallback) {
        const message = error?.data?.message || error?.message || fallback;
        this.inventory.notify(message, {type: "danger"});
    }
}

QualityTab.template = "barcode_stock_quality.QualityTab";
QualityTab.props = {
    pickingId: {type: [Number, {value: false}]},
};
