/** @odoo-module **/

import {registry} from "@web/core/registry";

export const barcodeApiService = {
    dependencies: ["orm", "notification", "dialog"],
    start(env, {orm, notification, dialog}) {
        return {
            async call(model, method, args = [], kwargs = {}) {
                try {
                    return await orm.call(model, method, args, kwargs);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while calling the server.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async searchRead(model, domain, fields, options = {}) {
                try {
                    return await orm.searchRead(model, domain, fields, options);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while fetching data.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async readGroup(model, domain, fields, groupby, options = {}) {
                try {
                    return await orm.readGroup(model, domain, fields, groupby, options);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while grouping data.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async read(model, ids, fields) {
                try {
                    return await orm.read(model, ids, fields);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while reading records.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async write(model, ids, data) {
                try {
                    return await orm.write(model, ids, data);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while saving records.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async create(model, data) {
                try {
                    return await orm.create(model, data);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while creating records.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            async unlink(model, ids) {
                try {
                    return await orm.unlink(model, ids);
                } catch (error) {
                    const message =
                        error.message || "An error occurred while deleting records.";
                    notification.add(message, {type: "danger"});
                    throw error;
                }
            },

            notify(message, options = {}) {
                notification.add(message, options);
            },

            openDialog(dialogClass, props = {}) {
                dialog.add(dialogClass, props);
            },
        };
    },
};

registry.category("services").add("barcodeApi", barcodeApiService);
