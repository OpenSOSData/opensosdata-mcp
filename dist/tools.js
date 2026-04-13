"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolDefinitions = exports.STATE_NAMES = exports.REGIONS = exports.VALID_STATES = void 0;
exports.getApiKey = getApiKey;
exports.callLookup = callLookup;
exports.callStates = callStates;
exports.pollAsyncJob = pollAsyncJob;
exports.searchEntity = searchEntity;
exports.handleToolCall = handleToolCall;
const axios_1 = __importDefault(require("axios"));
const API_BASE = process.env.OPENSOSDATA_API_URL || 'https://api.opensosdata.com';
function getApiKey() {
    return process.env.OPENSOSDATA_SERVICE_KEY || process.env.OPENSOSDATA_API_KEY || '';
}
exports.VALID_STATES = [
    'AK', 'AL', 'AR', 'AS', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID',
    'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND',
    'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN',
    'TX', 'UT', 'VA', 'VI', 'VT', 'WA', 'WI', 'WV', 'WY'
];
exports.REGIONS = {
    northeast: [
        { code: 'CT', name: 'Connecticut' }, { code: 'ME', name: 'Maine' },
        { code: 'MA', name: 'Massachusetts' }, { code: 'NH', name: 'New Hampshire' },
        { code: 'NJ', name: 'New Jersey' }, { code: 'NY', name: 'New York' },
        { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
        { code: 'VT', name: 'Vermont' }
    ],
    southeast: [
        { code: 'AL', name: 'Alabama' }, { code: 'AR', name: 'Arkansas' },
        { code: 'DC', name: 'Washington DC' }, { code: 'DE', name: 'Delaware' },
        { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' },
        { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
        { code: 'MD', name: 'Maryland' }, { code: 'MS', name: 'Mississippi' },
        { code: 'NC', name: 'North Carolina' }, { code: 'SC', name: 'South Carolina' },
        { code: 'TN', name: 'Tennessee' }, { code: 'VA', name: 'Virginia' },
        { code: 'WV', name: 'West Virginia' }
    ],
    midwest: [
        { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
        { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' },
        { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
        { code: 'MO', name: 'Missouri' }, { code: 'NE', name: 'Nebraska' },
        { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
        { code: 'SD', name: 'South Dakota' }, { code: 'WI', name: 'Wisconsin' }
    ],
    southwest: [
        { code: 'AZ', name: 'Arizona' }, { code: 'NM', name: 'New Mexico' },
        { code: 'OK', name: 'Oklahoma' }, { code: 'TX', name: 'Texas' }
    ],
    west: [
        { code: 'AK', name: 'Alaska' }, { code: 'CA', name: 'California' },
        { code: 'CO', name: 'Colorado' }, { code: 'HI', name: 'Hawaii' },
        { code: 'ID', name: 'Idaho' }, { code: 'MT', name: 'Montana' },
        { code: 'NV', name: 'Nevada' }, { code: 'OR', name: 'Oregon' },
        { code: 'UT', name: 'Utah' }, { code: 'WA', name: 'Washington' },
        { code: 'WY', name: 'Wyoming' }
    ],
    territories: [
        { code: 'PR', name: 'Puerto Rico' }, { code: 'VI', name: 'US Virgin Islands' },
        { code: 'AS', name: 'American Samoa' }
    ]
};
const STATE_NAMES = {};
exports.STATE_NAMES = STATE_NAMES;
for (const jurisdictions of Object.values(exports.REGIONS)) {
    for (const j of jurisdictions) {
        STATE_NAMES[j.code] = j.name;
    }
}
async function callLookup(entityName, state, apiKey) {
    const key = apiKey || getApiKey();
    const res = await axios_1.default.post(`${API_BASE}/v1/lookup`, { entity_name: entityName, state: state.toUpperCase() }, {
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        timeout: 120000
    });
    return res.data;
}
async function callStates(apiKey) {
    const key = apiKey || getApiKey();
    const res = await axios_1.default.get(`${API_BASE}/v1/states`, {
        headers: { 'x-api-key': key },
        timeout: 30000
    });
    return res.data;
}
async function pollAsyncJob(jobId, apiKey) {
    const key = apiKey || getApiKey();
    const maxAttempts = 40; // 40 * 3s = 120s max
    for (let i = 0; i < maxAttempts; i++) {
        const res = await axios_1.default.get(`${API_BASE}/v1/lookup/status/${jobId}`, {
            headers: { 'x-api-key': key },
            timeout: 10000
        });
        if (res.data.status === 'complete')
            return res.data;
        if (res.data.status === 'failed')
            throw new Error(res.data.error || 'Lookup failed');
        await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error('Lookup timed out after 120 seconds');
}
async function searchEntity(entityName, state, apiKey) {
    const resp = await callLookup(entityName, state, apiKey);
    // Handle async jobs (slow states with captcha)
    if (resp.async && resp.jobId) {
        return await pollAsyncJob(resp.jobId, apiKey);
    }
    return resp;
}
exports.toolDefinitions = [
    {
        name: 'search_business_entity',
        description: 'Search for a US business entity by name in a specific state or territory. Returns entity name, ID, status, type, registered agent, and address. Covers all 53 US jurisdictions including DC, Puerto Rico, and US Virgin Islands.',
        inputSchema: {
            type: 'object',
            properties: {
                entity_name: {
                    type: 'string',
                    description: 'The business entity name to search for'
                },
                state: {
                    type: 'string',
                    description: 'Two-letter US state or territory code (e.g. CA, NY, TX, DC, PR, VI)'
                }
            },
            required: ['entity_name', 'state']
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
    },
    {
        name: 'list_supported_jurisdictions',
        description: 'Returns all 53 US jurisdictions with live business entity search coverage, including all 50 states, Washington DC, Puerto Rico, and US Virgin Islands.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
    },
    {
        name: 'check_entity_status',
        description: 'Verify if a business entity is active, inactive, or dissolved in a specific US jurisdiction. Ideal for KYB compliance, due diligence, and vendor verification workflows.',
        inputSchema: {
            type: 'object',
            properties: {
                entity_name: {
                    type: 'string',
                    description: 'The business entity name to check'
                },
                state: {
                    type: 'string',
                    description: 'Two-letter US state or territory code'
                }
            },
            required: ['entity_name', 'state']
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
    },
    {
        name: 'batch_search',
        description: 'Search for multiple business entities simultaneously across different states. Maximum 10 entities per batch. Returns results for each entity in order.',
        inputSchema: {
            type: 'object',
            properties: {
                searches: {
                    type: 'array',
                    maxItems: 10,
                    description: 'List of entities to search (max 10)',
                    items: {
                        type: 'object',
                        properties: {
                            entity_name: { type: 'string', description: 'Business entity name' },
                            state: { type: 'string', description: 'Two-letter state code' }
                        },
                        required: ['entity_name', 'state']
                    }
                }
            },
            required: ['searches']
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
    },
    {
        name: 'get_jurisdictions_for_region',
        description: 'Get the list of US jurisdictions in a specific region. Useful for multi-state compliance checks and understanding regional coverage.',
        inputSchema: {
            type: 'object',
            properties: {
                region: {
                    type: 'string',
                    enum: ['northeast', 'southeast', 'midwest', 'southwest', 'west', 'territories', 'all'],
                    description: 'US region to get jurisdictions for'
                }
            },
            required: ['region']
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
    }
];
async function handleToolCall(name, args, apiKey) {
    if (name === 'search_business_entity') {
        const { entity_name, state } = args;
        const upper = state.toUpperCase();
        if (!exports.VALID_STATES.includes(upper)) {
            return { text: `Invalid state code: ${state}. Use a valid 2-letter US state/territory code.`, isError: true };
        }
        const result = await searchEntity(entity_name, upper, apiKey);
        if (!result.success || !result.data) {
            return { text: `No business entity found matching ${entity_name} in ${upper}.` };
        }
        return {
            text: JSON.stringify({
                entityName: result.data.entityName,
                entityId: result.data.entityId,
                status: result.data.status,
                entityType: result.data.entityType,
                state: upper,
                registeredAgent: result.data.registeredAgent,
                address: result.data.address,
                filingDate: result.data.filingDate,
                source: result.data.source
            }, null, 2)
        };
    }
    if (name === 'list_supported_jurisdictions') {
        const data = await callStates(apiKey);
        const active = data.filter((s) => s.status === 'active');
        const lines = active.map((s) => `${s.state}: ${STATE_NAMES[s.state] || s.state} (v${s.version})`);
        return {
            text: `OpenSOSData covers ${active.length} US jurisdictions with live real-time business entity search:\n\n${lines.join('\n')}`
        };
    }
    if (name === 'check_entity_status') {
        const { entity_name, state } = args;
        const upper = state.toUpperCase();
        if (!exports.VALID_STATES.includes(upper)) {
            return { text: `Invalid state code: ${state}.`, isError: true };
        }
        const result = await searchEntity(entity_name, upper, apiKey);
        if (!result.success || !result.data) {
            return { text: `${entity_name} was not found in the ${upper} business registry.` };
        }
        const status = result.data.status || '';
        const isActive = status.toLowerCase().includes('active') || status.toLowerCase().includes('good standing');
        return {
            text: JSON.stringify({
                entityName: result.data.entityName,
                state: upper,
                status,
                isActive,
                entityId: result.data.entityId,
                verificationNote: isActive
                    ? 'Entity is active and in good standing'
                    : 'Entity is not currently active. Verify before transacting.'
            }, null, 2)
        };
    }
    if (name === 'batch_search') {
        const { searches } = args;
        if (!Array.isArray(searches) || searches.length === 0) {
            return { text: 'No searches provided.', isError: true };
        }
        if (searches.length > 10) {
            return { text: 'Batch search is limited to 10 entities per request.', isError: true };
        }
        const results = await Promise.allSettled(searches.map((s) => searchEntity(s.entity_name, s.state.toUpperCase(), apiKey)));
        const output = searches.map((s, i) => {
            const r = results[i];
            if (r.status === 'rejected') {
                return { query: s, found: false, error: r.reason?.message || 'Search failed' };
            }
            if (!r.value.success || !r.value.data) {
                return { query: s, found: false, error: 'Not found' };
            }
            return {
                query: s,
                found: true,
                data: {
                    entityName: r.value.data.entityName,
                    entityId: r.value.data.entityId,
                    status: r.value.data.status,
                    entityType: r.value.data.entityType,
                    state: s.state.toUpperCase()
                }
            };
        });
        return { text: JSON.stringify(output, null, 2) };
    }
    if (name === 'get_jurisdictions_for_region') {
        const { region } = args;
        const jurisdictions = region === 'all'
            ? Object.values(exports.REGIONS).flat()
            : (exports.REGIONS[region] || []);
        if (jurisdictions.length === 0) {
            return { text: `Unknown region: ${region}. Valid: northeast, southeast, midwest, southwest, west, territories, all`, isError: true };
        }
        return {
            text: JSON.stringify({ region, jurisdictions, count: jurisdictions.length }, null, 2)
        };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
}
