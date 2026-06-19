import { useSuiClientQuery } from "@mysten/dapp-kit"
import { CREDENTIAL_TYPE } from "../constants"

export interface KeeperCredential {
  id: string
  keeper: string
  jobsCompleted: number
  bondedAmount: number
  activatedAt: number
}

export function useKeeperStatus(address: string | undefined) {
  const { data, isLoading, error, refetch } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: address ?? "",
      filter: { StructType: CREDENTIAL_TYPE },
      options: { showContent: true },
    },
    { enabled: !!address }
  )

  if (!address || isLoading) {
    return { loading: isLoading, credential: null, error: null, refetch }
  }

  if (error) {
    return { loading: false, credential: null, error: (error as Error).message, refetch }
  }

  const obj = data?.data?.[0]
  if (!obj?.data?.content) {
    return { loading: false, credential: null, error: null, refetch }
  }

  const f = (obj.data.content as { fields?: Record<string, unknown> })?.fields ?? {}
  const bondedFields = (f.bonded as { fields?: { value?: string } })?.fields
  const credential: KeeperCredential = {
    id:             obj.data.objectId,
    keeper:         String(f.keeper ?? address),
    jobsCompleted:  Number(f.jobs_completed ?? 0),
    bondedAmount:   Number(bondedFields?.value ?? 1_000_000_000),
    activatedAt:    Number(f.activated_at ?? 0),
  }

  return { loading: false, credential, error: null, refetch }
}
