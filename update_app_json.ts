import { readFileSync, writeFileSync } from 'node:fs';

const file = './app.json';

interface Translation {
  en: string;
}

interface DropdownValue {
  id: string;
  label: Translation;
}

interface FlowArgument {
  name: string;
  type: string;
  filter?: string;
  values?: DropdownValue[];
}

interface FlowAction {
  id: string;
  title: Translation;
  args: FlowArgument[];
}

interface AppJsonLike {
  flow?: {
    actions?: FlowAction[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const data = JSON.parse(readFileSync(file, 'utf8')) as AppJsonLike;

if (!data.flow) {
  data.flow = {};
}

if (!Array.isArray(data.flow.actions)) {
  data.flow.actions = [];
}

const action: FlowAction = {
  id: 'set_xcomfort_preset',
  title: { en: 'Set Heating preset' },
  args: [
    { name: 'device', type: 'device', filter: 'driver_id=thermostat' },
    {
      name: 'preset',
      type: 'dropdown',
      values: [
        { id: 'frost', label: { en: 'Frost' } },
        { id: 'eco', label: { en: 'Economy' } },
        { id: 'comfort', label: { en: 'Comfort' } },
      ],
    },
  ],
};

if (!data.flow.actions.some((existingAction) => existingAction.id === action.id)) {
  data.flow.actions.push(action);
}

writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log('Saved app.json');
