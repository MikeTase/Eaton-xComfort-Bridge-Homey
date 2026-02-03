"use strict";
/**
 * xComfort Bridge - Shared TypeScript Interfaces
 *
 * This file contains all shared type definitions used across the application.
 * All modules should import types from here to avoid duplication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShadingAction = exports.ClimateState = exports.ClimateMode = void 0;
// =============================================================================
// Device Types
// =============================================================================
/**
 * Climate/Heating Modes
 */
var ClimateMode;
(function (ClimateMode) {
    ClimateMode[ClimateMode["FrostProtection"] = 1] = "FrostProtection";
    ClimateMode[ClimateMode["Eco"] = 2] = "Eco";
    ClimateMode[ClimateMode["Comfort"] = 3] = "Comfort";
})(ClimateMode || (exports.ClimateMode = ClimateMode = {}));
/**
 * Climate/Heating States
 */
var ClimateState;
(function (ClimateState) {
    ClimateState[ClimateState["Off"] = 0] = "Off";
    ClimateState[ClimateState["HeatingAuto"] = 1] = "HeatingAuto";
    ClimateState[ClimateState["HeatingManual"] = 2] = "HeatingManual";
})(ClimateState || (exports.ClimateState = ClimateState = {}));
/**
 * Shading Actions
 */
var ShadingAction;
(function (ShadingAction) {
    ShadingAction[ShadingAction["OPEN"] = 0] = "OPEN";
    ShadingAction[ShadingAction["CLOSE"] = 1] = "CLOSE";
    ShadingAction[ShadingAction["STOP"] = 2] = "STOP";
    ShadingAction[ShadingAction["STEP_OPEN"] = 3] = "STEP_OPEN";
    ShadingAction[ShadingAction["STEP_CLOSE"] = 4] = "STEP_CLOSE";
    ShadingAction[ShadingAction["GO_TO"] = 5] = "GO_TO";
})(ShadingAction || (exports.ShadingAction = ShadingAction = {}));
