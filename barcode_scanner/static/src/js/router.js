/** @odoo-module **/

import {Reactive} from "@web/core/utils/reactive";
import {browser} from "@web/core/browser/browser";
import {registry} from "@web/core/registry";

const HISTORY_LIMIT = 50;

export class BarcodeRouter extends Reactive {
    static serviceDependencies = [];

    constructor(...args) {
        super(...args);
        this.setup(...args);
    }

    setup() {
        this.currentRoute = null;
        this.routeParams = {};
        this.history = [];
        this.routes = {};
    }

    registerRoute(name, config) {
        if (!config || !config.component) {
            throw new Error(`Route "${name}" must have a component.`);
        }
        this.routes[name] = {name, component: config.component};
    }

    _sanitizeHistoryState(state) {
        try {
            return JSON.parse(JSON.stringify(state));
        } catch {
            return {};
        }
    }

    navigate(routeName, params = {}, options = {}) {
        const route = this.routes[routeName];
        if (!route) {
            throw new Error(`Unknown route: ${routeName}`);
        }

        if (params.pickingId !== undefined) {
            const pickingId = parseInt(params.pickingId, 10);
            if (isNaN(pickingId) || pickingId <= 0) {
                throw new Error(`Invalid pickingId: ${params.pickingId}`);
            }
            params = {...params, pickingId};
        }
        if (params.picking_id !== undefined) {
            const pickingId = parseInt(params.picking_id, 10);
            if (isNaN(pickingId) || pickingId <= 0) {
                throw new Error(`Invalid picking_id: ${params.picking_id}`);
            }
            params = {...params, picking_id: pickingId};
        }

        if (this.currentRoute && !options.replace) {
            this.history.push({
                route: this.currentRoute,
                params: this.routeParams,
            });
            if (this.history.length > HISTORY_LIMIT) {
                this.history.shift();
            }
        }

        const historyState = this._sanitizeHistoryState({routeName, params});
        if (options.replace) {
            history.replaceState(historyState, "", browser.location.href);
        } else {
            history.pushState(historyState, "", browser.location.href);
        }

        this.currentRoute = route;
        this.routeParams = params;
    }

    goBack(overrides) {
        const previous = this.history.pop();
        if (previous) {
            this.currentRoute = previous.route;
            this.routeParams = overrides || previous.params;
            const historyState = this._sanitizeHistoryState({
                routeName: previous.route.name,
                params: this.routeParams,
            });
            history.replaceState(historyState, "", browser.location.href);
        } else {
            this.currentRoute = this.routes.main || null;
            this.routeParams = overrides || {};
            const historyState = this._sanitizeHistoryState({
                routeName: (this.routes.main || {}).name || "main",
                params: this.routeParams,
            });
            history.replaceState(historyState, "", browser.location.href);
        }
    }

    getState() {
        return {
            currentRoute: this.currentRoute,
            routeParams: this.routeParams,
            history: this.history,
        };
    }
}

export const barcodeRouterService = {
    dependencies: BarcodeRouter.serviceDependencies,
    start(env) {
        return new BarcodeRouter(env);
    },
};

registry.category("services").add("barcodeRouter", barcodeRouterService);
