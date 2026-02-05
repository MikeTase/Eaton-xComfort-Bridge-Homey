declare module 'homey' {
    export interface HomeySettings {
        get(key: string): any;
        set(key: string, value: any): Promise<void>;
        on(event: 'set', listener: (key: string) => void): void;
    }

    export interface HomeyFlow {
        getDeviceTriggerCard(id: string): FlowCardTriggerDevice | null;
    }

    export interface HomeyAppContext {
        settings: HomeySettings;
        flow: HomeyFlow;
        app: App;
    }

    export class App {
        homey: HomeyAppContext;
        log(...args: any[]): void;
        error(...args: any[]): void;
        onInit(): void | Promise<void>;
        on(event: string, listener: (...args: any[]) => void): this;
        emit(event: string, ...args: any[]): boolean;
        removeListener(event: string, listener: (...args: any[]) => void): this;
    }
    export class Device {
        homey: HomeyAppContext;
        log(...args: any[]): void;
        error(...args: any[]): void;
        onInit(): void | Promise<void>;
        onAdded?(): void | Promise<void>;
        onDeleted?(): void | Promise<void>;
        getData(): any;
        getSettings(): any;
        setSettings(settings: Record<string, any>): Promise<void>;
        getName(): string;
        getClass?(): string;
        getCapabilityValue(capabilityId: string): any;
        getCapabilities(): string[];
        hasCapability(capabilityId: string): boolean;
        addCapability(capabilityId: string): Promise<void>;
        removeCapability(capabilityId: string): Promise<void>;
        setCapabilityOptions(capabilityId: string, options: Record<string, any>): Promise<void>;
        setUnavailable(message?: string): void;
        setAvailable(): void;
        registerCapabilityListener(capabilityId: string, listener: (value: any, opts: any) => Promise<any> | any): void;
        registerMultipleCapabilityListener?(capabilityIds: string[], listener: (values: Record<string, any>, opts: any) => Promise<any> | any, debounce?: number): void;
        setCapabilityValue(capabilityId: string, value: any): Promise<void>;
        getStoreValue(key: string): any;
        setStoreValue(key: string, value: any): Promise<void>;
        unsetStoreValue?(key: string): Promise<void>;
    }
    export class Driver {
        homey: HomeyAppContext;
        log(...args: any[]): void;
        error(...args: any[]): void;
        onInit(): void | Promise<void>;
        onPair(session: any): void;
        onPairListDevices?(): Promise<any[]>;
        getDevices(): Device[];
        getDevice?(id: string): Device | null;
    }
    export interface PairSession {
        setHandler(event: string, handler: (data: any) => Promise<any>): void;
    }
    export interface FlowCardTriggerDevice {
        trigger(device: Device, tokens?: any, state?: any): Promise<void>;
    }
}
