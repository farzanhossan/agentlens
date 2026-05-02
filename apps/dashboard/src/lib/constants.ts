export const INGEST_BASE_URL = 'https://api-agentlens.techmatbd.com';

export function getIngestEndpoint(): string {
  return `${INGEST_BASE_URL}/v1/spans`;
}
