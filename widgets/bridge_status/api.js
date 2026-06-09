'use strict';

module.exports = {
  async getStatus({ homey }) {
    const app = homey.app;
    if (app && typeof app.getBridgeStatusSummary === 'function') {
      return app.getBridgeStatusSummary();
    }
    return [];
  },
};
