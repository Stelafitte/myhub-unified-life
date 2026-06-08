import { useEffect, useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

const searchSchema = z.object({
  token: z.string().optional(),
})

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  component: UnsubscribePage,
  head: () => ({
    meta: [{ title: 'Se désabonner' }],
  }),
})

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; email: string }
  | { kind: 'already' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

function UnsubscribePage() {
  const { token } = useSearch({ from: '/unsubscribe' })
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!token) {
      setState({ kind: 'invalid', message: 'Lien invalide ou expiré.' })
      return
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          setState({ kind: 'invalid', message: data.error || 'Lien invalide.' })
          return
        }
        if (data.alreadyUsed || data.used) {
          setState({ kind: 'already' })
          return
        }
        setState({ kind: 'ready', email: data.email || '' })
      })
      .catch(() => setState({ kind: 'invalid', message: 'Erreur réseau.' }))
  }, [token])

  const confirm = async () => {
    if (!token) return
    setState({ kind: 'submitting' })
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setState({ kind: 'error', message: data.error || 'Erreur' })
        return
      }
      setState({ kind: 'done' })
    } catch {
      setState({ kind: 'error', message: 'Erreur réseau.' })
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Se désabonner</h1>
        <div className="mt-6">
          {state.kind === 'loading' && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {state.kind === 'invalid' && (
            <p className="text-sm text-muted-foreground">{state.message}</p>
          )}
          {state.kind === 'already' && (
            <p className="text-sm text-muted-foreground">
              Cette adresse est déjà désabonnée. Vous ne recevrez plus d'emails.
            </p>
          )}
          {state.kind === 'ready' && (
            <>
              <p className="text-sm text-muted-foreground">
                Confirmer le désabonnement
                {state.email ? (
                  <>
                    {' '}de <strong className="text-foreground">{state.email}</strong>
                  </>
                ) : null}
                {' ?'}
              </p>
              <Button onClick={confirm} className="mt-6">
                Confirmer le désabonnement
              </Button>
            </>
          )}
          {state.kind === 'submitting' && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {state.kind === 'done' && (
            <p className="text-sm text-muted-foreground">
              Vous êtes désabonné·e. Vous ne recevrez plus d'emails de notre part.
            </p>
          )}
          {state.kind === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
        </div>
      </div>
    </div>
  )
}
