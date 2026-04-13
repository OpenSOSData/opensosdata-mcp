export declare function getApiKey(): string;
export declare const VALID_STATES: string[];
export declare const REGIONS: Record<string, Array<{
    code: string;
    name: string;
}>>;
declare const STATE_NAMES: Record<string, string>;
export { STATE_NAMES };
export declare function callLookup(entityName: string, state: string, apiKey?: string): Promise<any>;
export declare function callStates(apiKey?: string): Promise<any>;
export declare function pollAsyncJob(jobId: string, apiKey?: string): Promise<any>;
export declare function searchEntity(entityName: string, state: string, apiKey?: string): Promise<any>;
export declare const toolDefinitions: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            entity_name: {
                type: string;
                description: string;
            };
            state: {
                type: string;
                description: string;
            };
            searches?: undefined;
            region?: undefined;
        };
        required: string[];
    };
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            entity_name?: undefined;
            state?: undefined;
            searches?: undefined;
            region?: undefined;
        };
        required: string[];
    };
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            searches: {
                type: string;
                maxItems: number;
                description: string;
                items: {
                    type: string;
                    properties: {
                        entity_name: {
                            type: string;
                            description: string;
                        };
                        state: {
                            type: string;
                            description: string;
                        };
                    };
                    required: string[];
                };
            };
            entity_name?: undefined;
            state?: undefined;
            region?: undefined;
        };
        required: string[];
    };
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            region: {
                type: string;
                enum: string[];
                description: string;
            };
            entity_name?: undefined;
            state?: undefined;
            searches?: undefined;
        };
        required: string[];
    };
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
    };
})[];
export declare function handleToolCall(name: string, args: Record<string, any>, apiKey?: string): Promise<{
    text: string;
    isError?: boolean;
}>;
