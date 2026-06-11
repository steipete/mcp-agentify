"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPackageVersion = getPackageVersion;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function getPackageVersion() {
    const packageJsonPath = (0, node_path_1.resolve)(__dirname, '..', 'package.json');
    const packageJson = JSON.parse((0, node_fs_1.readFileSync)(packageJsonPath, 'utf8'));
    return packageJson.version || '0.0.0';
}
//# sourceMappingURL=utils.js.map