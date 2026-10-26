import axios from 'axios';

const API_BASE = process.env.OPENSOSDATA_API_URL || 'https://api.opensosdata.com';

export function getApiKey(): string {
  return process.env.OPENSOSDATA_SERVICE_KEY || process.env.OPENSOSDATA_API_KEY || '';
}


// --- Key Guard: test/diagnostic context protection ---
function isTestMode(): boolean {
  return process.env.MCP_TEST_MODE === "true" || process.env.MCP_TEST_MODE === "1";
}

function getTestKey(): string {
  return process.env.MCP_TEST_KEY || "";
}

/**
 * Guard billed/side-effect tool calls in test mode.
 * - If MCP_TEST_MODE is active and MCP_TEST_KEY is set, only the test key is allowed.
 * - If MCP_TEST_MODE is active and MCP_TEST_KEY is NOT set, all calls are refused (fail closed).
 * - If MCP_TEST_MODE is not active, all calls proceed normally.
 * Returns an error result if the call should be refused, or null if it should proceed.
 */
function guardTestContext(apiKey: string | undefined): { text: string; isError: true } | null {
  if (!isTestMode()) return null;

  const testKey = getTestKey();
  if (!testKey) {
    return {
      text: "MCP_TEST_MODE is active but MCP_TEST_KEY is not configured. All billed operations are refused (fail-closed). Set MCP_TEST_KEY to a billing-exempt internal key to proceed.",
      isError: true
    };
  }

  const effectiveKey = apiKey || getApiKey();
  if (effectiveKey !== testKey) {
    return {
      text: "MCP_TEST_MODE is active. Only the designated test key may perform lookups. This call was made with a non-test key and has been refused to prevent accidental billing.",
      isError: true
    };
  }

  // Test key matches -- allow the call through
  return null;
}

export const VALID_STATES = [
  'AK','AL','AR','AS','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID',
  'IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND',
  'NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','PR','RI','SC','SD','TN',
  'TX','UT','VA','VI','VT','WA','WI','WV','WY'
];

export const REGIONS: Record<string, Array<{ code: string; name: string }>> = {
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

const STATE_NAMES: Record<string, string> = {};
for (const jurisdictions of Object.values(REGIONS)) {
  for (const j of jurisdictions) {
    STATE_NAMES[j.code] = j.name;
  }
}
export { STATE_NAMES };

export async function callLookup(entityName: string, state: string, apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const res = await axios.post(
    `${API_BASE}/v1/lookup`,
    { entity_name: entityName, state: state.toUpperCase() },
    {
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      timeout: 120000
    }
  );
  return res.data;
}

export async function callStates(apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const res = await axios.get(`${API_BASE}/v1/states`, {
    headers: { 'x-api-key': key },
    timeout: 30000
  });
  return res.data;
}

export async function pollAsyncJob(jobId: string, apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const maxAttempts = 40; // 40 * 3s = 120s max
  for (let i = 0; i < maxAttempts; i++) {
    const res = await axios.get(`${API_BASE}/v1/lookup/status/${jobId}`, {
      headers: { 'x-api-key': key },
      timeout: 10000
    });
    if (res.data.status === 'complete') return res.data;
    if (res.data.status === 'failed') throw new Error(res.data.error || 'Lookup failed');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Lookup timed out after 120 seconds');
}

export async function searchEntity(entityName: string, state: string, apiKey?: string): Promise<any> {
  const resp = await callLookup(entityName, state, apiKey);
  // Handle async jobs (slow states with captcha)
  if (resp.async && resp.jobId) {
    return await pollAsyncJob(resp.jobId, apiKey);
  }
  return resp;
}

export const UCC_SUPPORTED_STATES = [
  'AK','AL','AZ','CA','CO','CT','FL','IA','ID','IN',
  'KY','MA','MO','MS','MT','NC','ND','NJ','NM','NY',
  'OH','OR','PA','RI','TN','VA'
];

export async function searchUCC(debtorName: string, state: string, maxResults?: number, apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const res = await axios.post(
    `${API_BASE}/v1/ucc/search`,
    { debtorName, state: state.toUpperCase(), maxResults: maxResults || 10 },
    {
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
        'x-mcp-client': 'opensosdata-mcp'
      },
      timeout: 260000
    }
  );
  return res.data;
}

export const toolDefinitions = [
  {
    name: 'search_business_entity',
    description: 'Search for a US business entity by name in a specific state or territory. Returns entity name, ID, status, type, registered agent, and address. Covers all 53 US jurisdictions including DC, Puerto Rico, and US Virgin Islands.',
    inputSchema: {
      type: 'object' as const,
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Search Business Entity' }
  },
  {
    name: 'list_supported_jurisdictions',
    description: 'Returns all 53 US jurisdictions with live business entity search coverage, including all 50 states, Washington DC, Puerto Rico, and US Virgin Islands.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'List Supported Jurisdictions' }
  },
  {
    name: 'check_entity_status',
    description: 'Verify if a business entity is active, inactive, or dissolved in a specific US jurisdiction. Ideal for KYB compliance, due diligence, and vendor verification workflows.',
    inputSchema: {
      type: 'object' as const,
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Check Entity Status' }
  },
  {
    name: 'batch_search',
    description: 'Search for multiple business entities simultaneously across different states. Maximum 10 entities per batch. Returns results for each entity in order.',
    inputSchema: {
      type: 'object' as const,
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Batch Entity Search' }
  },
  {
    name: 'get_jurisdictions_for_region',
    description: 'Get the list of US jurisdictions in a specific region. Useful for multi-state compliance checks and understanding regional coverage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: {
          type: 'string',
          enum: ['northeast', 'southeast', 'midwest', 'southwest', 'west', 'territories', 'all'],
          description: 'US region to get jurisdictions for'
        }
      },
      required: ['region']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Jurisdictions for Region' }
  },
  {
    name: 'search_ucc_filings',
    description: 'Search UCC (Uniform Commercial Code) lien filings by debtor name in a specific US state. Returns filing number, status (active/lapsed/terminated), debtor and secured party details, filing and lapse dates, and collateral description. Useful for due diligence, lien searches, and credit risk assessment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        debtor_name: {
          type: 'string',
          description: 'The debtor name to search for (person or business)'
        },
        state: {
          type: 'string',
          description: `Two-letter US state code. Supported: ${UCC_SUPPORTED_STATES.join(', ')}`
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of filings to return (1-30, default 10)'
        }
      },
      required: ['debtor_name', 'state']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Search UCC Filings' }
  },
  {
    name: "check_name_availability",
    description: "Check whether a business name is available to register in a US state or territory. Returns available: true/false plus up to 10 conflicting entity matches sorted by status (active first). Useful for business formation workflows, pre-registration research, and name conflict detection. Always queries live portal data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_name: {
          type: "string",
          description: "Business name to check availability for"
        },
        state: {
          type: "string",
          description: "Two-letter US state or territory code (e.g. CA, DE, NY)"
        }
      },
      required: ["entity_name", "state"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Check Name Availability' }
  },
  {
    name: 'create_agent_account',
    description: 'Create a new OpenSOSData agent account. This creates a pay-first agent account with ZERO free lookup allowance — the wallet must be funded via top_up_wallet before any lookups will succeed. Returns the osd_ API key exactly once; it cannot be retrieved again. Requires an email address.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: {
          type: 'string',
          description: 'Email address for the new agent account'
        },
        name: {
          type: 'string',
          description: 'Optional display name for the account'
        }
      },
      required: ['email']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: 'Create Agent Account' }
  },
  {
    name: 'top_up_wallet',
    description: 'INITIATES A REAL PAYMENT to add wallet credit to an OpenSOSData agent account. Accepts a tier selection: starter ($50, 500 lookups), growth ($100, 1333 lookups), scale ($250, 5000 lookups), or enterprise ($500, 15923 lookups). Returns a payment challenge that must be completed to finalize the top-up. This spends real money.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tier: {
          type: 'string',
          enum: ['starter', 'growth', 'scale', 'enterprise'],
          description: 'Payment tier: starter ($50), growth ($100), scale ($250), enterprise ($500)'
        }
      },
      required: ['tier']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, title: 'Top Up Wallet' }
  },
  {
    name: 'check_balance',
    description: 'Check the current wallet balance and remaining lookup count for the authenticated OpenSOSData account.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Check Balance' }
  }
];

export async function handleToolCall(name: string, args: Record<string, any>, apiKey?: string): Promise<{ text: string; isError?: boolean }> {
  if (name === 'search_business_entity') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { entity_name, state } = args;
    const upper = (state as string).toUpperCase();
    if (!VALID_STATES.includes(upper)) {
      return { text: `Invalid state code: ${state}. Use a valid 2-letter US state/territory code.`, isError: true };
    }
    const result = await searchEntity(entity_name, upper, apiKey);
    if (!result.success || !result.data) {
      return { text: `No business entity found matching ${entity_name} in ${upper}.` };
    }
    return {
      text: JSON.stringify({ ...result.data, state: upper }, null, 2)
    };
  }

  if (name === 'list_supported_jurisdictions') {
    const data = await callStates(apiKey);
    const active = (data as any[]).filter((s: any) => s.status === 'active');
    const lines = active.map((s: any) => `${s.state}: ${STATE_NAMES[s.state] || s.state} (v${s.version})`);
    return {
      text: `OpenSOSData covers ${active.length} US jurisdictions with live real-time business entity search:\n\n${lines.join('\n')}`
    };
  }

  if (name === 'check_entity_status') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { entity_name, state } = args;
    const upper = (state as string).toUpperCase();
    if (!VALID_STATES.includes(upper)) {
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
        ...result.data,
        state: upper,
        isActive,
        verificationNote: isActive
          ? 'Entity is active and in good standing'
          : 'Entity is not currently active. Verify before transacting.'
      }, null, 2)
    };
  }

  if (name === 'batch_search') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { searches } = args;
    if (!Array.isArray(searches) || searches.length === 0) {
      return { text: 'No searches provided.', isError: true };
    }
    if (searches.length > 10) {
      return { text: 'Batch search is limited to 10 entities per request.', isError: true };
    }
    const results = await Promise.allSettled(
      searches.map((s: any) => searchEntity(s.entity_name, s.state.toUpperCase(), apiKey))
    );
    const output = searches.map((s: any, i: number) => {
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
        data: { ...r.value.data, state: s.state.toUpperCase() }
      };
    });
    return { text: JSON.stringify(output, null, 2) };
  }

  if (name === 'get_jurisdictions_for_region') {
    const { region } = args;
    const jurisdictions = region === 'all'
      ? Object.values(REGIONS).flat()
      : (REGIONS[region] || []);
    if (jurisdictions.length === 0) {
      return { text: `Unknown region: ${region}. Valid: northeast, southeast, midwest, southwest, west, territories, all`, isError: true };
    }
    return {
      text: JSON.stringify({ region, jurisdictions, count: jurisdictions.length }, null, 2)
    };
  }

  if (name === 'search_ucc_filings') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { debtor_name, state, max_results } = args;
    const upper = (state as string).toUpperCase();
    if (!UCC_SUPPORTED_STATES.includes(upper)) {
      return { text: `UCC search is not supported for state: ${state}. Supported states: ${UCC_SUPPORTED_STATES.join(', ')}`, isError: true };
    }
    const result = await searchUCC(debtor_name, upper, max_results, apiKey);
    if (!result.success) {
      return { text: result.error || `UCC search failed for "${debtor_name}" in ${upper}.`, isError: true };
    }
    if (!result.results || result.results.length === 0) {
      return { text: `No UCC filings found for "${debtor_name}" in ${upper}.` };
    }
    const filings = result.results.map((f: any) => ({
      fileNumber: f.fileNumber,
      status: f.status,
      debtorName: f.debtorName,
      debtorAddress: f.debtorAddress,
      debtorType: f.debtorType,
      securedPartyName: f.securedPartyName,
      securedPartyAddress: f.securedPartyAddress,
      filingDate: f.filingDate,
      lapseDate: f.lapseDate,
      collateralDescription: f.collateralDescription,
      jurisdiction: f.jurisdiction,
      sourceUrl: f.sourceUrl
    }));
    return {
      text: JSON.stringify({
        totalFound: result.totalFound,
        jurisdiction: result.jurisdiction,
        cached: result.cached,
        filings
      }, null, 2)
    };
  }

  if (name === "check_name_availability") {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { entity_name, state } = args;
    const upper = (state as string).toUpperCase();
    if (!VALID_STATES.includes(upper)) {
      return { text: `Invalid state code: ${state}. Use a valid 2-letter US state/territory code.`, isError: true };
    }
    const key = apiKey || getApiKey();
    const res = await axios.post(
      `${API_BASE}/v1/name-availability`,
      { entity_name, state: upper },
      {
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        timeout: 120000
      }
    );
    const data = res.data as any;
    if (!data.success && data.error) {
      return { text: `Error: ${data.error}`, isError: true };
    }
    return {
      text: JSON.stringify({ ...data, state: upper }, null, 2)
    };
  }

  if (name === 'create_agent_account') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { email, name: accountName } = args;
    if (!email || typeof email !== 'string') {
      return { text: 'Email is required to create an agent account.', isError: true };
    }
    try {
      const res = await axios.post(
        `${API_BASE}/v1/agent/signup`,
        { email, name: accountName || undefined },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
          validateStatus: () => true
        }
      );
      if (res.status === 404) {
        return { text: 'This capability is not yet available. Agent self-service signup has not been enabled.' };
      }
      if (res.status === 409) {
        return { text: 'An account with this email already exists.', isError: true };
      }
      if (res.status === 201 && res.data?.success) {
        return {
          text: JSON.stringify({
            success: true,
            userId: res.data.userId,
            apiKey: res.data.apiKey,
            note: 'IMPORTANT: This API key is shown only once and cannot be retrieved again. This is a pay-first account with zero balance — fund it via top_up_wallet before performing lookups.'
          }, null, 2)
        };
      }
      return { text: res.data?.error || `Signup failed (HTTP ${res.status})`, isError: true };
    } catch (err: any) {
      return { text: `Error creating agent account: ${err.message}`, isError: true };
    }
  }

  if (name === 'top_up_wallet') {
    const guardResult = guardTestContext(apiKey);
    if (guardResult) return guardResult;
    const { tier } = args;
    const validTiers = ['starter', 'growth', 'scale', 'enterprise'];
    if (!tier || !validTiers.includes(tier)) {
      return { text: `Invalid tier. Choose one of: ${validTiers.join(', ')}`, isError: true };
    }
    const key = apiKey || getApiKey();
    if (!key) {
      return { text: 'API key is required. Authenticate first or provide an osd_ API key.', isError: true };
    }
    try {
      const res = await axios.post(
        `${API_BASE}/v1/mpp/topup`,
        { tier },
        {
          headers: {
            'x-api-key': key,
            'Content-Type': 'application/json'
          },
          timeout: 30000,
          validateStatus: () => true
        }
      );
      if (res.status === 404) {
        return { text: 'This capability is not yet available. Agent wallet top-up has not been enabled.' };
      }
      // MPP challenge flow returns various statuses (402 for payment challenge, 200 for receipt)
      return {
        text: JSON.stringify({
          status: res.status,
          ...(res.data || {})
        }, null, 2)
      };
    } catch (err: any) {
      return { text: `Error initiating top-up: ${err.message}`, isError: true };
    }
  }

  if (name === 'check_balance') {
    const key = apiKey || getApiKey();
    if (!key) {
      return { text: 'API key is required. Authenticate first or provide an osd_ API key.', isError: true };
    }
    try {
      const res = await axios.get(
        `${API_BASE}/v1/account/balance`,
        {
          headers: {
            'x-api-key': key,
            'x-mcp-client': 'opensosdata-mcp'
          },
          timeout: 15000,
          validateStatus: () => true
        }
      );
      if (res.status === 404) {
        return { text: 'This capability is not yet available.' };
      }
      if (!res.data?.success) {
        return { text: res.data?.error || `Balance check failed (HTTP ${res.status})`, isError: true };
      }
      return {
        text: JSON.stringify({
          balance: res.data.balanceDisplay,
          lookupsRemaining: res.data.lookupsRemaining,
          pricePerLookup: res.data.pricePerLookup,
          accountType: res.data.type
        }, null, 2)
      };
    } catch (err: any) {
      return { text: `Error checking balance: ${err.message}`, isError: true };
    }
  }

  return { text: `Unknown tool: ${name}`, isError: true };
}
