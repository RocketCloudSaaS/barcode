import {registry} from "@web/core/registry";

const cameraRoutes = registry.category("barcode_camera_routes");

for (const route of [
    "cycle_count_list",
    "cycle_count_location",
    "cycle_count_count",
    "cycle_count_done",
]) {
    cameraRoutes.add(route, route);
}
