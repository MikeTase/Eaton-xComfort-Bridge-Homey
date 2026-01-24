declare module 'homey' {
    export class App {
        homey: any;
        log(...args: any[]): void;
        error(...args: any[]): void;
        onInit(): void | Promise<void>;
    }
    export class Device {
        homey: any;
        log(...args: any[]): void;
        error(...args: any[]): void;
        onInit(): void | Promise<void>;
        getData(): any;
        getName(): string;
        setUnavailable(message?: string): void;
        setAvailable(): void;
        registerCapabilityListener(capabilityId: string, listener: (value: any, opts: any) => Promise<any> | any): void;
        setCapabilityValue(capabilityId: string, value: any): Promise<void>;
    }
    export class Driver {
        homey: any;
        onPair(session: any): void;
    }
    export interface PairSession {
        setHandler(event: string, handler: (data: any) => Promise<any>): void;
    }
    export interface FlowCardTriggerDevice {
        trigger(device: Device, tokens?: any, state?: any): Promise<void>;
    }
}
