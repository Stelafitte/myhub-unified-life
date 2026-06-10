import React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  applicantName?: string
  spaceName?: string
  spaceDescription?: string | null
  accessUrl?: string
}

const SpaceJoinApprovedEmail = ({
  applicantName = 'Bonjour',
  spaceName = 'un projet collaboratif',
  spaceDescription = null,
  accessUrl = '#',
}: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>{`Votre accès à ${spaceName} est validé`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Bienvenue dans {spaceName}</Heading>
        <Text style={text}>Bonjour {applicantName},</Text>
        <Text style={text}>
          Votre demande pour rejoindre <strong>{spaceName}</strong> a été acceptée.
        </Text>
        {spaceDescription && (
          <Section style={descBox}>
            <Text style={descText}>{spaceDescription}</Text>
          </Section>
        )}
        <Section style={{ textAlign: 'center', margin: '28px 0' }}>
          <Button href={accessUrl} style={button}>
            Accéder au projet
          </Button>
        </Section>
        <Text style={smallText}>
          Ou copiez ce lien personnel dans votre navigateur :
          <br />
          <Link href={accessUrl} style={link}>{accessUrl}</Link>
        </Text>
        <Hr style={hr} />
        <Text style={footer}>Ce lien vous est personnel. Ne le partagez pas.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SpaceJoinApprovedEmail,
  subject: (data: Record<string, unknown>) =>
    `Accès validé : ${(data.spaceName as string) || 'projet collaboratif'}`,
  displayName: 'Validation de demande d\'adhésion',
  previewData: {
    applicantName: 'Marie',
    spaceName: 'Étude EchoCardio 2026',
    spaceDescription: 'Espace partagé pour le suivi du protocole.',
    accessUrl: 'https://example.com/space/abc?g=token',
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
const smallText = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#6b7280',
  margin: '20px 0 0 0',
  wordBreak: 'break-all' as const,
}
const descBox = {
  backgroundColor: '#f9fafb',
  borderLeft: '3px solid #0a0a0a',
  padding: '12px 16px',
  margin: '16px 0',
  borderRadius: '4px',
}
const descText = { fontSize: '14px', lineHeight: '22px', color: '#374151', margin: 0 }
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
const link = { color: '#2563eb', textDecoration: 'underline' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0 16px 0' }
const footer = { fontSize: '12px', color: '#9ca3af', margin: 0 }
