export enum MessageType {
  /* Keep Alive */
  ACK = 1,
  HEARTBEAT = 2,

  /* Connection */
  CONNECTION_START = 10,
  CONNECTION_CONFIRM = 11,

  /* Handshake */
  SC_INIT = 14,
  SC_PUBLIC_KEY = 15,
  SC_CLIENT_KEY = 16,
  SC_ACK = 17,

  /* Auth */
  LOGIN = 30,
  LOGIN_OK = 31,
  LOGIN_RESPONSE = 32,

  /* Discovery */
  REQUEST_DEVICES = 240,
  REQUEST_ROOMS = 242,
  SET_ALL_DATA = 300,

  /* Control */
  ACTION_SLIDE_DEVICE = 280,
  ACTION_SWITCH_DEVICE = 281,

  /* Events */
  SET_DEVICE_STATE = 291,
  SET_STATE_INFO = 310
}

export interface BridgeMessage {
  type: MessageType;
  payload?: any;
}

export interface DeviceState {
  deviceId: string;
  switch?: boolean;
  dimmvalue?: number;
}
