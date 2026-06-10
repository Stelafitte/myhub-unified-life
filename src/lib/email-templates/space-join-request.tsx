import React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  ownerName?: string
  applicantName?: string
  applicantEmail?: string
  spaceName?: string
  reviewUrl?: string
}

const SpaceJoinRequestEmail = ({
  ownerName = 'Bonjour',
  applicantName = 'Une personne',
  applicantEmail = '',
  spaceName = 'votre projet',
  reviewUrl = '#',
}: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>{`${applicantName} demande à rejoindre ${spaceName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Nouvelle demande d'adhésion</Heading>
        <Text style={text}>Bonjour {ownerName},</Text>
        <Text style={text}>
          <strong>{applicantName}</strong>{applicantEmail ? ` (${applicantEmail})` : ''} demande à
          rejoindre le projet collaboratif <strong>{spaceName}</strong>.
        </Text>
        <Section style={{ textAlign: 'center', margin: '28px 0' }}>
          <Button href={reviewUrl} style={button}>
            Examiner la demande
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          Vous recevez ce message car vous êtes le propriétaire de ce projet.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SpaceJoinRequestEmail,
  subject: (data: Record<string, unknown>) =>
    `Demande d'adhésion : ${(data.spaceName as string) || 'votre projet'}`,
  displayName: "Demande d'adhésion à un projet",
  previewData: {
    ownerName: 'Sébastien',
    applicantName: 'Marie Durand',
    applicantEmail: 'marie@example.com',
    spaceName: 'Étude EchoCardio 2026',
    reviewUrl: 'https://example.com/collaborate/space/abc',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 600, color: '#0a0a0a', margin: '0 0 20px 0' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#1f2937', margin: '0 0 14px 0' }
const button = {
  backgroundColor: '#0a0a0a',
  color: '#ffffff',
  padding: '12px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontSize: '15px',
  fontWeight: 600,
  display: 'inline-block',
}
const hr = { borderColor: '#e5e7eb', margin: '28px 0 16px 0' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: 0 }
