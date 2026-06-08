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
  guestName?: string
  inviterName?: string
  spaceName?: string
  subjectLine?: string
  message?: string
  accessUrl?: string
}

const SpaceUpdateEmail = ({
  guestName = 'Bonjour',
  inviterName = 'Un collaborateur',
  spaceName = 'votre projet collaboratif',
  subjectLine = 'Nouvelle mise à jour',
  message = '',
  accessUrl = '#',
}: Props) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>{`${subjectLine} — ${spaceName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{subjectLine}</Heading>
        <Text style={text}>Bonjour {guestName},</Text>
        <Text style={text}>
          <strong>{inviterName}</strong> vous informe d'une nouveauté sur le projet{' '}
          <strong>{spaceName}</strong>.
        </Text>
        {message && (
          <Section style={msgBox}>
            {message
              .split('\n')
              .filter(Boolean)
              .map((line, i) => (
                <Text key={i} style={msgLine}>
                  {line}
                </Text>
              ))}
          </Section>
        )}
        <Section style={{ textAlign: 'center', margin: '28px 0' }}>
          <Button href={accessUrl} style={btn}>
            Ouvrir le projet
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          Ce lien est personnel — il vous donne accès uniquement à ce projet.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SpaceUpdateEmail,
  subject: (data: Record<string, any>) =>
    data?.subjectLine ? String(data.subjectLine) : 'Mise à jour de votre projet collaboratif',
  displayName: 'Mise à jour espace collaboratif',
  previewData: {
    guestName: 'Marie',
    inviterName: 'S_Lafitte Pro',
    spaceName: 'Comité FMC CP',
    subjectLine: 'Nouveau document ajouté',
    message: 'Un nouveau document a été partagé dans le chat.\nMerci de le consulter avant la prochaine réunion.',
    accessUrl: 'https://example.com/space/abc?g=xyz',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '22px', margin: '0 0 12px' }
const msgBox = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '14px 16px',
  margin: '16px 0',
}
const msgLine = { fontSize: '14px', color: '#0f172a', lineHeight: '20px', margin: '0 0 6px' }
const btn = {
  background: '#0f172a',
  color: '#ffffff',
  padding: '10px 22px',
  borderRadius: '6px',
  fontSize: '14px',
  textDecoration: 'none',
}
const hr = { borderColor: '#e2e8f0', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#64748b', textAlign: 'center' as const }
