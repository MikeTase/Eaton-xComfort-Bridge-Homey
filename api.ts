interface DiagnosticsApp {
  getDiagnosticsExport?: () => Record<string, unknown>;
}

interface DiagnosticsApiArgs {
  homey: {
    app?: DiagnosticsApp;
  };
}

module.exports = {
  async getDiagnostics({ homey }: DiagnosticsApiArgs): Promise<Record<string, unknown>> {
    if (!homey.app || typeof homey.app.getDiagnosticsExport !== 'function') {
      throw new Error('Diagnostics export is not available');
    }

    return homey.app.getDiagnosticsExport();
  },
};
