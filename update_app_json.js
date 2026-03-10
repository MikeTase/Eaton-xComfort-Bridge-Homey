const fs = require('fs');
const file = './app.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!data.flow) data.flow = {};
if (!data.flow.actions) data.flow.actions = [];

const action = {
  id: 'set_xcomfort_preset',
  title: { en: 'Set Heating preset' },
  args: [
    { name: 'device', type: 'device', filter: 'driver_id=thermostat' },
    { name: 'preset', type: 'dropdown', values: [
        { id: 'frost', label: { en: 'Frost' } },
        { id: 'eco', label: { en: 'Economy' } },
        { id: 'comfort', label: { en: 'Comfort' } }
      ]
    }
  ]
};

if (!data.flow.actions.find(a => a.id === action.id)) {
    data.flow.actions.push(action);
}

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('Saved app.json');
