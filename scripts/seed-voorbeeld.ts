/**
 * Voorbeeld demo seed script.
 *
 * Usage: npx tsx scripts/seed-voorbeeld.ts
 *
 * Creates the Voorbeeld demo organization with 3 teams, 8 projects,
 * 9 users, issues, time entries, sprints, automation, and wiki content.
 *
 * Safe to run multiple times (idempotent via upserts / existence checks).
 * Does NOT modify existing Aranea.Dev seed data.
 */

import '../src/config/load-env';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Helpers ────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.warn('Seeding Voorbeeld demo data...\n');

  // ────────────────────────────────────────────────────────────
  // 1. Users
  // ────────────────────────────────────────────────────────────
  console.warn('  [1/12] Users');
  const passwordHash = await bcrypt.hash('password123', 12);

  // Tim Schipper already exists from seed-demo.ts -- look him up
  const existingTim = await prisma.user.findUnique({ where: { username: 'tim' } });
  if (!existingTim) {
    throw new Error('User "tim" not found. Run seed-demo.ts first: npm run db:seed:demo');
  }

  const newUserData = [
    { username: 'erik', displayName: 'Erik Bakker', email: 'erik@voorbeeld.example' },
    { username: 'sanne', displayName: 'Sanne de Boer', email: 'sanne@voorbeeld.example' },
    { username: 'mila', displayName: 'Mila Smit', email: 'mila@voorbeeld.example' },
    { username: 'joris', displayName: 'Joris Visser', email: 'joris@voorbeeld.example' },
    { username: 'fenna', displayName: 'Fenna Mulder', email: 'fenna@voorbeeld.example' },
    { username: 'ruben', displayName: 'Ruben Kok', email: 'ruben@voorbeeld.example' },
    { username: 'anika', displayName: 'Anika Bos', email: 'anika@voorbeeld.example' },
    { username: 'thijs', displayName: 'Thijs Meijer', email: 'thijs@voorbeeld.example' },
  ] as const;

  const users: Record<string, { id: string }> = { tim: existingTim };
  for (const u of newUserData) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
    users[u.username] = user;
    console.warn(`        ${u.displayName} (${u.email})`);
  }

  // ────────────────────────────────────────────────────────────
  // 2. Organization + memberships
  // ────────────────────────────────────────────────────────────
  console.warn('  [2/12] Organization');
  const org = await prisma.organization.upsert({
    where: { slug: 'voorbeeld' },
    update: {},
    create: {
      name: 'Voorbeeld',
      slug: 'voorbeeld',
      description: 'Voorbeeld - Digitale oplossingen voor partners en klanten',
    },
  });

  const orgRoles: Record<string, 'OWNER' | 'MEMBER'> = {
    erik: 'OWNER',
    tim: 'MEMBER',
    sanne: 'MEMBER',
    mila: 'MEMBER',
    joris: 'MEMBER',
    fenna: 'MEMBER',
    ruben: 'MEMBER',
    anika: 'MEMBER',
    thijs: 'MEMBER',
  };

  for (const [username, role] of Object.entries(orgRoles)) {
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: users[username].id, orgId: org.id } },
      update: { role },
      create: { userId: users[username].id, orgId: org.id, role },
    });
  }
  console.warn(`        Voorbeeld (${Object.keys(orgRoles).length} members)`);

  // ────────────────────────────────────────────────────────────
  // 3. Teams + memberships
  // ────────────────────────────────────────────────────────────
  console.warn('  [3/12] Teams');

  const teamDefs = [
    { name: 'Team Noord', slug: 'team-noord', description: 'Team Noord applicaties en integraties' },
    { name: 'Team Zuid', slug: 'team-zuid', description: 'Team Zuid applicaties en klantportalen' },
    { name: 'Team AI', slug: 'team-ai', description: 'AI-ontwikkeling en machine learning toepassingen' },
  ] as const;

  const teams: Record<string, { id: string }> = {};
  for (const td of teamDefs) {
    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId: org.id, slug: td.slug } },
      update: {},
      create: { orgId: org.id, ...td },
    });
    teams[td.slug] = team;
  }

  // Team memberships: { teamSlug: { username: role } }
  const teamMemberDefs: Record<string, Record<string, 'ADMIN' | 'MEMBER'>> = {
    'team-noord': { erik: 'ADMIN', tim: 'ADMIN', sanne: 'MEMBER', mila: 'MEMBER' },
    'team-zuid': { erik: 'ADMIN', joris: 'MEMBER', fenna: 'MEMBER', ruben: 'MEMBER' },
    'team-ai': { erik: 'ADMIN', anika: 'MEMBER', thijs: 'MEMBER' },
  };

  for (const [teamSlug, members] of Object.entries(teamMemberDefs)) {
    for (const [username, role] of Object.entries(members)) {
      await prisma.teamMembership.upsert({
        where: { userId_teamId: { userId: users[username].id, teamId: teams[teamSlug].id } },
        update: { role },
        create: { userId: users[username].id, teamId: teams[teamSlug].id, role },
      });
    }
    console.warn(`        ${teamSlug} (${Object.keys(members).length} members)`);
  }

  // ────────────────────────────────────────────────────────────
  // 4. Projects + board columns + labels
  // ────────────────────────────────────────────────────────────
  console.warn('  [4/12] Projects');

  const columnDefs = [
    { name: 'Backlog', position: 0, isDefault: true, isDone: false },
    { name: 'Te Doen', position: 1, isDefault: false, isDone: false },
    { name: 'In Ontwikkeling', position: 2, isDefault: false, isDone: false },
    { name: 'Code Review', position: 3, isDefault: false, isDone: false },
    { name: 'Testen', position: 4, isDefault: false, isDone: false },
    { name: 'Gereed', position: 5, isDefault: false, isDone: true },
  ];

  const labelDefs = [
    { name: 'urgent', color: '#EF4444' },
    { name: 'onderhoud', color: '#6B7280' },
    { name: 'verbetering', color: '#3B82F6' },
    { name: 'bug', color: '#F97316' },
    { name: 'nieuw', color: '#22C55E' },
    { name: 'infrastructuur', color: '#8B5CF6' },
  ];

  const projectDefs = [
    { teamSlug: 'team-noord', name: 'Partnerportaal', slug: 'partnerportaal', prefix: 'PPT', description: 'Partner self-service portaal voor het partnerkanaal' },
    { teamSlug: 'team-noord', name: 'Commissie Engine', slug: 'commissie-engine', prefix: 'CME', description: 'Commissieberekeningen en uitbetalingen' },
    { teamSlug: 'team-noord', name: 'Dealregistratie', slug: 'dealregistratie', prefix: 'DLR', description: 'Dealregistratie en pipelinesysteem' },
    { teamSlug: 'team-zuid', name: 'Klantportaal', slug: 'klantportaal', prefix: 'KPT', description: 'Klantportaal voor directe klanten' },
    { teamSlug: 'team-zuid', name: 'Offertetool', slug: 'offertetool', prefix: 'OFT', description: 'Offerte-aanmaak en goedkeuringsworkflow' },
    { teamSlug: 'team-zuid', name: 'Orderverwerking', slug: 'orderverwerking', prefix: 'OVW', description: 'Orderverwerking en fulfillment' },
    { teamSlug: 'team-ai', name: 'AI Assistent', slug: 'ai-assistent', prefix: 'AIA', description: 'Interne AI-assistent en chatbot' },
    { teamSlug: 'team-ai', name: 'Documentherkenning', slug: 'documentherkenning', prefix: 'DCH', description: 'Documentherkenning en OCR-verwerking' },
  ];

  // Store project IDs, column IDs, and label IDs for later use
  const projects: Record<string, { id: string; teamSlug: string }> = {};
  const projectColumns: Record<string, Record<string, string>> = {};
  const projectLabels: Record<string, Record<string, string>> = {};

  for (const pd of projectDefs) {
    const existing = await prisma.project.findUnique({
      where: { teamId_slug: { teamId: teams[pd.teamSlug].id, slug: pd.slug } },
    });

    let project: { id: string };
    if (existing) {
      project = existing;
    } else {
      project = await prisma.project.create({
        data: {
          teamId: teams[pd.teamSlug].id,
          name: pd.name,
          slug: pd.slug,
          prefix: pd.prefix,
          description: pd.description,
          columns: { createMany: { data: columnDefs } },
        },
      });
    }
    projects[pd.slug] = { id: project.id, teamSlug: pd.teamSlug };

    // Fetch columns
    const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
    const colMap: Record<string, string> = {};
    for (const c of cols) colMap[c.name] = c.id;
    projectColumns[pd.slug] = colMap;

    // Upsert labels
    const lblMap: Record<string, string> = {};
    for (const ld of labelDefs) {
      const label = await prisma.label.upsert({
        where: { projectId_name: { projectId: project.id, name: ld.name } },
        update: { color: ld.color },
        create: { projectId: project.id, name: ld.name, color: ld.color },
      });
      lblMap[ld.name] = label.id;
    }
    projectLabels[pd.slug] = lblMap;

    // Set card color by priority
    await prisma.project.update({
      where: { id: project.id },
      data: { cardColorBy: 'priority' },
    });

    console.warn(`        ${pd.name} (${pd.prefix})`);
  }

  // Set WIP limits
  for (const slug of Object.keys(projects)) {
    const cols = projectColumns[slug];
    if (cols['In Ontwikkeling']) {
      await prisma.boardColumn.update({ where: { id: cols['In Ontwikkeling'] }, data: { wipLimit: 3 } });
    }
    if (cols['Code Review']) {
      await prisma.boardColumn.update({ where: { id: cols['Code Review'] }, data: { wipLimit: 3 } });
    }
    if (cols['Te Doen']) {
      await prisma.boardColumn.update({ where: { id: cols['Te Doen'] }, data: { wipLimit: 5 } });
    }
  }

  // ────────────────────────────────────────────────────────────
  // 5. Milestones
  // ────────────────────────────────────────────────────────────
  console.warn('  [5/12] Milestones');

  const milestoneDefs = [
    { projectSlug: 'partnerportaal', title: 'Q2 2026 Release', dueDate: new Date('2026-06-30') },
    { projectSlug: 'klantportaal', title: 'Klantportaal v2.0', dueDate: new Date('2026-05-31') },
    { projectSlug: 'ai-assistent', title: 'AI Platform MVP', dueDate: new Date('2026-07-31') },
  ];

  const milestones: Record<string, { id: string }> = {};
  for (const md of milestoneDefs) {
    const ms = await prisma.milestone.upsert({
      where: { projectId_title: { projectId: projects[md.projectSlug].id, title: md.title } },
      update: {},
      create: {
        projectId: projects[md.projectSlug].id,
        title: md.title,
        dueDate: md.dueDate,
        status: 'OPEN',
      },
    });
    milestones[md.projectSlug] = ms;
    console.warn(`        ${md.title} (${md.projectSlug})`);
  }

  // ────────────────────────────────────────────────────────────
  // 6. Sprints
  // ────────────────────────────────────────────────────────────
  console.warn('  [6/12] Sprints');

  const sprintStart = daysAgo(8);
  const sprintEnd = futureDate(6);

  const sprintDefs = [
    { projectSlug: 'partnerportaal', name: 'Sprint 2026-Q2-1', goal: 'SSO-integratie eerste fase en bugfixes' },
    { projectSlug: 'commissie-engine', name: 'Sprint 2026-Q2-1', goal: 'Commissierapportage verbeteren' },
    { projectSlug: 'dealregistratie', name: 'Sprint 2026-Q2-1', goal: 'Pipeline dashboard en notificaties' },
    { projectSlug: 'klantportaal', name: 'Sprint 2026-Q2-1', goal: 'Huisstijl migratie en performance' },
    { projectSlug: 'offertetool', name: 'Sprint 2026-Q2-1', goal: 'PDF-export en template systeem' },
    { projectSlug: 'orderverwerking', name: 'Sprint 2026-Q2-1', goal: 'Batch verwerking en foutafhandeling' },
    { projectSlug: 'ai-assistent', name: 'Sprint 2026-Q2-1', goal: 'RAG-pipeline opzetten en testen' },
    { projectSlug: 'documentherkenning', name: 'Sprint 2026-Q2-1', goal: 'Handgeschreven tekst herkenning verbeteren' },
  ];

  const sprints: Record<string, { id: string }> = {};
  for (const sd of sprintDefs) {
    const existing = await prisma.sprint.findFirst({
      where: { projectId: projects[sd.projectSlug].id, name: sd.name },
    });
    if (existing) {
      sprints[sd.projectSlug] = existing;
    } else {
      const sprint = await prisma.sprint.create({
        data: {
          projectId: projects[sd.projectSlug].id,
          name: sd.name,
          goal: sd.goal,
          startDate: sprintStart,
          endDate: sprintEnd,
          status: 'ACTIVE',
          committedAt: sprintStart,
        },
      });
      sprints[sd.projectSlug] = sprint;
    }
    console.warn(`        ${sd.name} (${sd.projectSlug})`);
  }

  // ────────────────────────────────────────────────────────────
  // 7. Issues - Epics (complex change requests)
  // ────────────────────────────────────────────────────────────
  console.warn('  [7/12] Epics');

  type EpicSeed = {
    projectSlug: string;
    title: string;
    body: string;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    creator: string;
    status: string; // Epic workflow status (stored in body/title convention, column = Backlog)
  };

  const epicDefs: EpicSeed[] = [
    {
      projectSlug: 'partnerportaal',
      title: 'SSO-integratie voor partnerportaal',
      body: '## Wijzigingsverzoek\n\nAlle partners moeten kunnen inloggen via hun eigen Microsoft Entra ID (voorheen Azure AD). Huidige situatie: lokale accounts met wachtwoord. Gewenste situatie: SAML/OIDC federatie met automatische provisioning.\n\n## Impact\n- Partnerportaal frontend (login flow)\n- Backend auth module (SAML/OIDC provider)\n- Gebruikersbeheer (auto-provisioning)\n\n## Status: Goedgekeurd - In Uitvoering',
      priority: 'HIGH',
      creator: 'erik',
      status: 'Goedgekeurd',
    },
    {
      projectSlug: 'commissie-engine',
      title: 'Automatische commissieberekening herstructureren',
      body: '## Wijzigingsverzoek\n\nDe huidige commissieberekening is gebaseerd op Excel-imports en handmatige controles. Dit moet geautomatiseerd worden met real-time berekeningen op basis van CRM-data.\n\n## Impact\n- Commissie Engine backend (berekeningslogica)\n- Nieuwe API-koppelingen met CRM\n- Rapportagemodule aanpassen\n\n## Status: Ingediend - Wacht op beoordeling',
      priority: 'MEDIUM',
      creator: 'sanne',
      status: 'Ingediend',
    },
    {
      projectSlug: 'klantportaal',
      title: 'Klantportaal migratie naar nieuwe huisstijl',
      body: '## Wijzigingsverzoek\n\nHet klantportaal moet gemigreerd worden naar de nieuwe Voorbeeld huisstijl. Dit omvat een volledig nieuw design system, responsive layout, en toegankelijkheidsverbeteringen (WCAG 2.1 AA).\n\n## Impact\n- Alle frontend componenten\n- Design tokens en thema\n- Toegankelijkheidsaudit en fixes\n\n## Status: Goedgekeurd - In Uitvoering',
      priority: 'HIGH',
      creator: 'erik',
      status: 'Goedgekeurd',
    },
    {
      projectSlug: 'offertetool',
      title: 'Offerte-goedkeuring workflow digitaliseren',
      body: '## Wijzigingsverzoek\n\nHet huidige goedkeuringsproces voor offertes boven 50k verloopt via e-mail en is foutgevoelig. Gewenst: digitale workflow met escalatie, audit trail, en Teams-notificaties.\n\n## Impact\n- Offertetool backend (workflow engine)\n- Nieuwe goedkeurings-UI\n- Microsoft Teams integratie\n\n## Status: Ingediend - Wacht op beoordeling',
      priority: 'MEDIUM',
      creator: 'fenna',
      status: 'Ingediend',
    },
    {
      projectSlug: 'ai-assistent',
      title: 'RAG-pipeline voor interne kennisbank',
      body: '## Wijzigingsverzoek\n\nOpzetten van een Retrieval-Augmented Generation pipeline zodat de AI-assistent antwoorden kan baseren op interne documentatie (Confluence, SharePoint, handleidingen).\n\n## Impact\n- Document ingestion pipeline (nieuwe component)\n- Vector database (Qdrant/Pinecone)\n- AI Assistent backend (RAG integratie)\n\n## Status: Goedgekeurd - In Uitvoering',
      priority: 'HIGH',
      creator: 'erik',
      status: 'Goedgekeurd',
    },
    {
      projectSlug: 'documentherkenning',
      title: 'Factuurherkenning uitbreiden met handgeschreven documenten',
      body: '## Wijzigingsverzoek\n\nDe huidige OCR-pipeline herkent alleen getypte tekst. Uitbreiden met handgeschreven tekst herkenning (HTR) voor handgeschreven facturen en formulieren.\n\n## Impact\n- OCR-pipeline (nieuw HTR-model)\n- Training data verzamelen en labelen\n- Kwaliteitsmonitoring dashboard\n\n## Status: Ingediend - Wacht op beoordeling',
      priority: 'MEDIUM',
      creator: 'thijs',
      status: 'Ingediend',
    },
  ];

  const epicIssues: Record<string, { id: string; projectSlug: string }> = {};

  for (const epic of epicDefs) {
    const projectId = projects[epic.projectSlug].id;
    const existingEpic = await prisma.issue.findFirst({
      where: { projectId, title: epic.title },
    });

    if (existingEpic) {
      epicIssues[epic.title] = { id: existingEpic.id, projectSlug: epic.projectSlug };
      continue;
    }

    const maxIssue = await prisma.issue.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const nextNumber = (maxIssue?.number ?? 0) + 1;

    const created = await prisma.issue.create({
      data: {
        projectId,
        number: nextNumber,
        title: epic.title,
        body: epic.body,
        type: 'EPIC',
        priority: epic.priority,
        columnId: projectColumns[epic.projectSlug]['Backlog'],
        creatorId: users[epic.creator].id,
        position: 0,
      },
    });
    epicIssues[epic.title] = { id: created.id, projectSlug: epic.projectSlug };
    console.warn(`        [EPIC] ${epic.title}`);
  }

  // ────────────────────────────────────────────────────────────
  // 8. Issues - Stories, Tasks, Bugs
  // ────────────────────────────────────────────────────────────
  console.warn('  [8/12] Issues');

  type IssueSeed = {
    projectSlug: string;
    title: string;
    body: string;
    type: 'TASK' | 'BUG' | 'STORY';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    column: string;
    assignee?: string;
    creator: string;
    labels?: string[];
    parentTitle?: string; // Links to epic
    inSprint?: boolean;
    dueDate?: Date;
    milestoneSlug?: string;
  };

  const issueDefs: IssueSeed[] = [
    // -- Partnerportaal (PPT) - Sanne --
    { projectSlug: 'partnerportaal', title: 'SAML-authenticatie provider implementeren', body: 'Implementeer SAML 2.0 authenticatie provider voor Microsoft Entra ID integratie. Inclusief metadata exchange en assertion validation.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'sanne', creator: 'erik', labels: ['nieuw'], parentTitle: 'SSO-integratie voor partnerportaal', inSprint: true, milestoneSlug: 'partnerportaal' },
    { projectSlug: 'partnerportaal', title: 'Automatische gebruikersprovisioning', body: 'Bij eerste SSO-login automatisch een gebruikersaccount aanmaken op basis van SAML-claims (naam, email, organisatie).', type: 'STORY', priority: 'HIGH', column: 'Te Doen', assignee: 'sanne', creator: 'erik', labels: ['nieuw'], parentTitle: 'SSO-integratie voor partnerportaal', inSprint: true, milestoneSlug: 'partnerportaal' },
    { projectSlug: 'partnerportaal', title: 'SSO login pagina redesign', body: 'Login pagina aanpassen met "Inloggen met bedrijfsaccount" knop naast het bestaande login formulier.', type: 'STORY', priority: 'MEDIUM', column: 'Backlog', creator: 'sanne', labels: ['nieuw'], parentTitle: 'SSO-integratie voor partnerportaal' },
    { projectSlug: 'partnerportaal', title: 'Partnerdashboard laadt traag bij veel orders', body: 'Het dashboard heeft 5+ seconden nodig bij partners met meer dan 1000 orders. Query optimalisatie nodig op de orders tabel.', type: 'BUG', priority: 'HIGH', column: 'Code Review', assignee: 'sanne', creator: 'tim', labels: ['bug'], inSprint: true },
    { projectSlug: 'partnerportaal', title: 'Verouderde Node.js dependencies updaten', body: 'Verschillende npm packages hebben bekende kwetsbaarheden. Update naar laatste minor/patch versies en test regressies.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'sanne', labels: ['onderhoud'] },
    { projectSlug: 'partnerportaal', title: 'Partnerrapportage CSV-export', body: 'Partners willen hun maandelijkse rapportages als CSV kunnen downloaden voor verwerking in Excel.', type: 'TASK', priority: 'MEDIUM', column: 'Gereed', assignee: 'sanne', creator: 'erik', labels: ['verbetering'], inSprint: true },

    // -- Commissie Engine (CME) - Tim --
    { projectSlug: 'commissie-engine', title: 'Commissierapport per partner genereren', body: 'Maandelijks rapport met commissie-overzicht per partner, inclusief breakdown per product en periode.', type: 'STORY', priority: 'MEDIUM', column: 'In Ontwikkeling', assignee: 'tim', creator: 'tim', labels: ['verbetering'], inSprint: true },
    { projectSlug: 'commissie-engine', title: 'Afrondingsverschillen in kwartaalafrekening', body: 'Bij kwartaalafrekeningen ontstaan afrondingsverschillen van 1-2 cent door floating point berekeningen. Overschakelen naar integer-based (centen) berekeningen.', type: 'BUG', priority: 'MEDIUM', column: 'Gereed', assignee: 'tim', creator: 'sanne', labels: ['bug'], inSprint: true },
    { projectSlug: 'commissie-engine', title: 'Database indexen optimaliseren', body: 'De commissieberekening query duurt te lang bij grote datasets. Ontbrekende indexen toevoegen op partner_id en period kolommen.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'tim', labels: ['onderhoud'] },
    { projectSlug: 'commissie-engine', title: 'API endpoint voor real-time commissie preview', body: 'Nieuw endpoint dat een preview toont van de commissie voor de huidige maand, zodat partners dit in hun portaal kunnen zien.', type: 'STORY', priority: 'MEDIUM', column: 'Te Doen', assignee: 'tim', creator: 'erik', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'commissie-engine', title: 'Commissieregels validatie verbeteren', body: 'Betere validatie bij het invoeren van commissieregels: percentage check, datumoverlap detectie, product coverage controle.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'tim', labels: ['verbetering'] },

    // -- Dealregistratie (DLR) - Mila --
    { projectSlug: 'dealregistratie', title: 'Pipeline dashboard met drag-and-drop', body: 'Visueel dashboard waar deals tussen fases gesleept kunnen worden. Inclusief filtering op partner, product en waarde.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'mila', creator: 'mila', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'dealregistratie', title: 'E-mail notificaties bij statuswijziging', body: 'Automatische e-mail naar de deal-eigenaar wanneer de status van een deal wijzigt (bijv. van "Offerte" naar "Gewonnen").', type: 'TASK', priority: 'MEDIUM', column: 'Testen', assignee: 'mila', creator: 'erik', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'dealregistratie', title: 'Dubbele deals detectie', body: 'Bij het registreren van een nieuwe deal controleren op mogelijke duplicaten op basis van klantnaam, product en bedrag.', type: 'STORY', priority: 'MEDIUM', column: 'Te Doen', creator: 'mila', labels: ['verbetering'], inSprint: true },
    { projectSlug: 'dealregistratie', title: 'Legacy API v1 endpoints verwijderen', body: 'De v1 API endpoints worden niet meer gebruikt. Verwijderen en bijbehorende tests opschonen.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'mila', labels: ['onderhoud'] },
    { projectSlug: 'dealregistratie', title: 'Deal import uit Excel fout bij speciale tekens', body: 'Excel import faalt bij bedrijfsnamen met &, < of > tekens. HTML-entities worden niet correct geescaped.', type: 'BUG', priority: 'HIGH', column: 'Gereed', assignee: 'mila', creator: 'sanne', labels: ['bug'], inSprint: true },

    // -- Klantportaal (KPT) - Joris --
    { projectSlug: 'klantportaal', title: 'Design tokens implementeren voor nieuwe huisstijl', body: 'CSS custom properties opzetten voor kleuren, typografie en spacing volgens het nieuwe Voorbeeld brand book.', type: 'STORY', priority: 'HIGH', column: 'Gereed', assignee: 'joris', creator: 'erik', labels: ['nieuw'], parentTitle: 'Klantportaal migratie naar nieuwe huisstijl', inSprint: true, milestoneSlug: 'klantportaal' },
    { projectSlug: 'klantportaal', title: 'Navigatie component refactoring', body: 'Hoofdnavigatie en sidebar herschrijven met nieuwe design tokens. Responsive gedrag verbeteren voor tablet en mobiel.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'joris', creator: 'erik', labels: ['nieuw'], parentTitle: 'Klantportaal migratie naar nieuwe huisstijl', inSprint: true, milestoneSlug: 'klantportaal' },
    { projectSlug: 'klantportaal', title: 'Toegankelijkheidsaudit uitvoeren', body: 'WCAG 2.1 AA audit uitvoeren op alle paginas. Focus op kleurcontrast, keyboard navigatie en screen reader ondersteuning.', type: 'STORY', priority: 'MEDIUM', column: 'Te Doen', creator: 'joris', labels: ['verbetering'], parentTitle: 'Klantportaal migratie naar nieuwe huisstijl' },
    { projectSlug: 'klantportaal', title: 'Sessie timeout melding toevoegen', body: 'Gebruikers krijgen geen waarschuwing voordat hun sessie verloopt. Toon een melding 5 minuten voor timeout met optie om te verlengen.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'joris', labels: ['verbetering'] },
    { projectSlug: 'klantportaal', title: 'Performance audit en bundle size reductie', body: 'Lighthouse score is onder de 70. Bundle analyseren, lazy loading implementeren en ongebruikte dependencies verwijderen.', type: 'TASK', priority: 'MEDIUM', column: 'Code Review', assignee: 'joris', creator: 'joris', labels: ['onderhoud'], inSprint: true },

    // -- Offertetool (OFT) - Fenna --
    { projectSlug: 'offertetool', title: 'PDF-export met bedrijfstemplate', body: 'Offertes exporteren als PDF met het Voorbeeld briefpapier, inclusief logo, contactgegevens en juridische tekst in de footer.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'fenna', creator: 'fenna', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'offertetool', title: 'Offerte template systeem', body: 'Herbruikbare templates voor veelvoorkomende offertes. Inclusief variabelen voor klantgegevens, producten en prijzen.', type: 'STORY', priority: 'MEDIUM', column: 'Te Doen', assignee: 'fenna', creator: 'erik', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'offertetool', title: 'Prijsberekening fout bij staffelkortingen', body: 'Bij staffelkortingen met meer dan 3 schijven wordt de korting dubbel berekend. Berekening valideren en unit tests toevoegen.', type: 'BUG', priority: 'CRITICAL', column: 'Gereed', assignee: 'fenna', creator: 'ruben', labels: ['bug', 'urgent'], inSprint: true },
    { projectSlug: 'offertetool', title: 'Offerte versiegeschiedenis', body: 'Bijhouden welke wijzigingen er per versie zijn gemaakt. Diff-view tonen tussen versies.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'fenna', labels: ['verbetering'] },
    { projectSlug: 'offertetool', title: 'Unit tests uitbreiden voor prijsmodule', body: 'Code coverage van de prijsberekeningsmodule is 42%. Uitbreiden naar minimaal 80% met edge cases voor kortingen en BTW.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'fenna', labels: ['onderhoud'] },

    // -- Orderverwerking (OVW) - Ruben --
    { projectSlug: 'orderverwerking', title: 'Batch verwerking van orders', body: 'Orders die via EDI binnenkomen in bulk verwerken in plaats van een voor een. Verwachte performance winst: 10x.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'ruben', creator: 'ruben', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'orderverwerking', title: 'Foutafhandeling bij mislukte orders verbeteren', body: 'Mislukte orders belanden nu in een dead letter queue zonder context. Foutmelding, oorspronkelijke order data en retry-optie toevoegen.', type: 'STORY', priority: 'HIGH', column: 'Te Doen', assignee: 'ruben', creator: 'erik', labels: ['verbetering'], inSprint: true },
    { projectSlug: 'orderverwerking', title: 'Order status webhook naar klantportaal', body: 'Real-time webhook notificaties sturen naar het klantportaal wanneer de orderstatus wijzigt.', type: 'TASK', priority: 'MEDIUM', column: 'Testen', assignee: 'ruben', creator: 'joris', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'orderverwerking', title: 'Memory leak bij langlopende batch jobs', body: 'Na 2+ uur batch verwerking stijgt het geheugengebruik boven 2GB. Vermoedelijk worden processed records niet vrijgegeven.', type: 'BUG', priority: 'CRITICAL', column: 'Gereed', assignee: 'ruben', creator: 'ruben', labels: ['bug', 'urgent'], inSprint: true },
    { projectSlug: 'orderverwerking', title: 'Monitoring dashboard voor orderflow', body: 'Dashboard met real-time metrics: orders per uur, gemiddelde verwerkingstijd, error rate, queue depth.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'ruben', labels: ['infrastructuur'] },

    // -- AI Assistent (AIA) - Anika --
    { projectSlug: 'ai-assistent', title: 'Document ingestion pipeline opzetten', body: 'Pipeline voor het inlezen, chunken en embedden van documenten uit Confluence en SharePoint. Gebruik LangChain voor orkestratie.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'anika', creator: 'anika', labels: ['nieuw'], parentTitle: 'RAG-pipeline voor interne kennisbank', inSprint: true, milestoneSlug: 'ai-assistent' },
    { projectSlug: 'ai-assistent', title: 'Vector store integratie met Qdrant', body: 'Qdrant als vector database configureren voor het opslaan en doorzoeken van document embeddings.', type: 'STORY', priority: 'HIGH', column: 'Te Doen', assignee: 'anika', creator: 'anika', labels: ['nieuw'], parentTitle: 'RAG-pipeline voor interne kennisbank', inSprint: true, milestoneSlug: 'ai-assistent' },
    { projectSlug: 'ai-assistent', title: 'Context window optimalisatie', body: 'Het RAG-systeem stuurt te veel context mee waardoor het antwoord traag en duur is. Implementeer relevantie-scoring en context pruning.', type: 'STORY', priority: 'MEDIUM', column: 'Backlog', creator: 'anika', labels: ['verbetering'], parentTitle: 'RAG-pipeline voor interne kennisbank' },
    { projectSlug: 'ai-assistent', title: 'Chatbot geeft foutieve antwoorden over verlofbeleid', body: 'De chatbot haalt verlofbeleid uit een verouderd document. Bron-validatie en document versioning toevoegen.', type: 'BUG', priority: 'HIGH', column: 'Gereed', assignee: 'anika', creator: 'thijs', labels: ['bug'], inSprint: true },
    { projectSlug: 'ai-assistent', title: 'Token usage monitoring en kostenbeheersing', body: 'Dashboard voor het bijhouden van API-kosten per model, per gebruiker en per dag. Alerts bij overschrijding budget.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'anika', labels: ['infrastructuur'] },

    // -- Documentherkenning (DCH) - Thijs --
    { projectSlug: 'documentherkenning', title: 'OCR-pipeline migreren naar Azure Document Intelligence', body: 'Huidige Tesseract-based pipeline vervangen door Azure Document Intelligence voor betere nauwkeurigheid en taalondersteuning.', type: 'STORY', priority: 'HIGH', column: 'In Ontwikkeling', assignee: 'thijs', creator: 'thijs', labels: ['verbetering'], inSprint: true },
    { projectSlug: 'documentherkenning', title: 'Kwaliteitsmonitoring dashboard', body: 'Dashboard met OCR-nauwkeurigheid per documenttype, confidence scores en trend-analyse over tijd.', type: 'STORY', priority: 'MEDIUM', column: 'Te Doen', assignee: 'thijs', creator: 'erik', labels: ['nieuw'], inSprint: true },
    { projectSlug: 'documentherkenning', title: 'PDF met meerdere paginas wordt niet correct gesplitst', body: 'Multi-page PDFs worden als een enkel document verwerkt in plaats van per pagina. Pagina-detectie en splitsing toevoegen.', type: 'BUG', priority: 'HIGH', column: 'Gereed', assignee: 'thijs', creator: 'anika', labels: ['bug'], inSprint: true },
    { projectSlug: 'documentherkenning', title: 'Training data labeling tool', body: 'Interne tool voor het labelen van training data voor het HTR-model. Bounding box annotatie en export naar COCO format.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'thijs', labels: ['nieuw'] },
    { projectSlug: 'documentherkenning', title: 'Docker image size reduceren', body: 'Het Docker image is 4.2GB door ML-model binaries. Multi-stage build en model lazy loading implementeren.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'thijs', labels: ['onderhoud', 'infrastructuur'] },
  ];

  // Track created issues per project for sprint assignment
  const createdIssues: { id: string; projectSlug: string; title: string; inSprint?: boolean; column?: string; assignee?: string; type?: string }[] = [];

  for (const issue of issueDefs) {
    const projectId = projects[issue.projectSlug].id;
    const existingIssue = await prisma.issue.findFirst({
      where: { projectId, title: issue.title },
    });

    if (existingIssue) {
      // Ensure timeEstimate is set on re-runs
      if (issue.assignee && !existingIssue.timeEstimate) {
        const seed = issue.title.length;
        let est: number;
        if (issue.type === 'STORY') {
          est = 480 + ((seed * 7) % 9) * 60;
        } else if (issue.type === 'BUG') {
          est = 60 + ((seed * 11) % 7) * 30;
        } else {
          est = 120 + ((seed * 13) % 5) * 30;
        }
        await prisma.issue.update({ where: { id: existingIssue.id }, data: { timeEstimate: est } });
      }
      createdIssues.push({ id: existingIssue.id, projectSlug: issue.projectSlug, title: issue.title, inSprint: issue.inSprint, column: issue.column, assignee: issue.assignee, type: issue.type });
      continue;
    }

    const maxIssue = await prisma.issue.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const nextNumber = (maxIssue?.number ?? 0) + 1;

    // Resolve parent epic
    let parentId: string | undefined;
    if (issue.parentTitle && epicIssues[issue.parentTitle]) {
      parentId = epicIssues[issue.parentTitle].id;
    }

    // Resolve milestone
    let milestoneId: string | undefined;
    if (issue.milestoneSlug && milestones[issue.milestoneSlug]) {
      milestoneId = milestones[issue.milestoneSlug].id;
    }

    const labelIds = (issue.labels ?? [])
      .filter((l) => projectLabels[issue.projectSlug][l])
      .map((l) => ({ id: projectLabels[issue.projectSlug][l] }));

    // Deterministic timeEstimate based on issue type (in minutes)
    let timeEstimate: number | undefined;
    if (issue.assignee) {
      // Use title length as deterministic seed for variation
      const seed = issue.title.length;
      if (issue.type === 'STORY') {
        // Stories: 480-960 minutes (8-16 hours), steps of 60
        timeEstimate = 480 + ((seed * 7) % 9) * 60;
      } else if (issue.type === 'BUG') {
        // Bugs: 60-240 minutes (1-4 hours), steps of 30
        timeEstimate = 60 + ((seed * 11) % 7) * 30;
      } else {
        // Tasks: 120-240 minutes (2-4 hours), steps of 30
        timeEstimate = 120 + ((seed * 13) % 5) * 30;
      }
    }

    const created = await prisma.issue.create({
      data: {
        projectId,
        number: nextNumber,
        title: issue.title,
        body: issue.body,
        type: issue.type,
        priority: issue.priority,
        columnId: projectColumns[issue.projectSlug][issue.column] ?? projectColumns[issue.projectSlug]['Backlog'],
        assigneeId: issue.assignee ? users[issue.assignee].id : undefined,
        creatorId: users[issue.creator].id,
        parentId,
        milestoneId,
        dueDate: issue.dueDate ?? null,
        position: nextNumber,
        labels: { connect: labelIds },
        timeEstimate,
      },
    });
    createdIssues.push({ id: created.id, projectSlug: issue.projectSlug, title: issue.title, inSprint: issue.inSprint, column: issue.column, assignee: issue.assignee, type: issue.type });
  }
  console.warn(`        ${createdIssues.length} issues created`);

  // Assign sprint issues
  for (const issue of createdIssues) {
    if (issue.inSprint && sprints[issue.projectSlug]) {
      await prisma.issue.update({
        where: { id: issue.id },
        data: { sprintId: sprints[issue.projectSlug].id },
      });
      const existingHistory = await prisma.sprintIssueHistory.findFirst({
        where: { sprintId: sprints[issue.projectSlug].id, issueId: issue.id },
      });
      if (!existingHistory) {
        await prisma.sprintIssueHistory.create({
          data: {
            sprintId: sprints[issue.projectSlug].id,
            issueId: issue.id,
            action: 'ADDED',
            timestamp: daysAgo(8),
          },
        });
      }
    }
  }
  console.warn('        Sprint assignments done');

  // ────────────────────────────────────────────────────────────
  // 9. Time entries (deterministic daily spread over 14 workdays)
  // ────────────────────────────────────────────────────────────
  console.warn('  [9/12] Time entries');

  const activeColumns = ['In Ontwikkeling', 'Code Review', 'Testen', 'Gereed'];
  const timeDescriptions = ['Implementatie', 'Code review', 'Onderzoek', 'Testing', 'Documentatie'];

  // Build list of workdays over the last 14 calendar days (skip weekends)
  const workdays: Date[] = [];
  for (let d = 1; d <= 20 && workdays.length < 14; d++) {
    const date = daysAgo(d);
    const dow = date.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) workdays.push(date);
  }

  // Collect all assigned issues in active columns, grouped by assignee
  type ActiveIssue = { id: string; assigneeId: string; projectSlug: string; column: string; titleLen: number };
  const activeIssuesByAssignee: Record<string, ActiveIssue[]> = {};

  for (const issue of createdIssues) {
    if (!issue.assignee || !activeColumns.includes(issue.column ?? '')) continue;
    const fullIssue = await prisma.issue.findUnique({
      where: { id: issue.id },
      include: { column: true },
    });
    if (!fullIssue || !fullIssue.assigneeId) continue;

    const col = fullIssue.column?.name ?? '';
    if (!activeColumns.includes(col)) continue;

    const ai: ActiveIssue = {
      id: issue.id,
      assigneeId: fullIssue.assigneeId,
      projectSlug: issue.projectSlug,
      column: col,
      titleLen: issue.title.length,
    };
    if (!activeIssuesByAssignee[fullIssue.assigneeId]) activeIssuesByAssignee[fullIssue.assigneeId] = [];
    activeIssuesByAssignee[fullIssue.assigneeId].push(ai);
  }

  let timeEntryCount = 0;

  for (const [assigneeId, issues] of Object.entries(activeIssuesByAssignee)) {
    // Check if time entries already exist for this user (skip if already seeded)
    const existingEntries = await prisma.timeEntry.count({
      where: { userId: assigneeId, issueId: { in: issues.map((i) => i.id) } },
    });
    if (existingEntries > 0) continue;

    // For each workday, log 6-8 hours spread across this person's issues
    for (let dayIdx = 0; dayIdx < workdays.length; dayIdx++) {
      const day = workdays[dayIdx];
      // Deterministic daily hours: varies by person and day for interesting workload patterns
      // Some devs work 6h days, others 8h+; some days lighter than others
      const personSeed = assigneeId.charCodeAt(0) + assigneeId.charCodeAt(assigneeId.length - 1);
      const dayVariation = ((dayIdx * 37 + personSeed) % 7) * 30; // 0-180 min variation
      const personBase = 300 + ((personSeed * 13) % 5) * 30; // 300-420 min base (5-7h)
      const dailyMinutes = personBase + dayVariation; // 300-600 min (5-10h)

      // Spread across issues deterministically
      const numIssues = issues.length;
      let remainingMinutes = dailyMinutes;

      for (let issueIdx = 0; issueIdx < numIssues && remainingMinutes > 0; issueIdx++) {
        const iss = issues[issueIdx];
        // Each issue gets a share; last issue gets the remainder
        let entryMinutes: number;
        if (issueIdx === numIssues - 1) {
          entryMinutes = remainingMinutes;
        } else {
          // Deterministic split: base of 60-180 min per issue
          const base = 60 + ((dayIdx * 13 + issueIdx * 17 + iss.titleLen) % 5) * 30;
          entryMinutes = Math.min(base, remainingMinutes);
        }
        if (entryMinutes <= 0) continue;

        const descIdx = (dayIdx + issueIdx + iss.titleLen) % timeDescriptions.length;

        await prisma.timeEntry.create({
          data: {
            issueId: iss.id,
            userId: assigneeId,
            minutes: entryMinutes,
            description: timeDescriptions[descIdx],
            loggedAt: day,
          },
        });
        remainingMinutes -= entryMinutes;
        timeEntryCount++;
      }
    }
  }

  // Update timeSpent on all active issues and set realistic updatedAt on completed issues
  for (const issue of createdIssues) {
    if (!issue.assignee || !activeColumns.includes(issue.column ?? '')) continue;

    const totalMinutes = await prisma.timeEntry.aggregate({
      where: { issueId: issue.id },
      _sum: { minutes: true },
    });
    const spent = totalMinutes._sum.minutes ?? 0;
    if (spent > 0) {
      await prisma.issue.update({
        where: { id: issue.id },
        data: { timeSpent: spent },
      });
    }

    // For completed issues ("Gereed"), set updatedAt to 2-7 days after createdAt for realistic lead times
    if (issue.column === 'Gereed') {
      const fullIssue = await prisma.issue.findUnique({ where: { id: issue.id }, select: { createdAt: true } });
      if (fullIssue) {
        // Deterministic offset: 2-7 days based on title length
        const offsetDays = 2 + (issue.title.length % 6);
        const completedDate = new Date(fullIssue.createdAt);
        completedDate.setDate(completedDate.getDate() + offsetDays);
        await prisma.$executeRaw`UPDATE "issues" SET "updatedAt" = ${completedDate} WHERE "id"::text = ${issue.id}`;
      }
    }
  }

  console.warn(`        ${timeEntryCount} time entries`);

  // ────────────────────────────────────────────────────────────
  // 10. Automation rules
  // ────────────────────────────────────────────────────────────
  console.warn('  [10/12] Automation rules');

  let automationCount = 0;
  for (const [slug, proj] of Object.entries(projects)) {
    const existingRules = await prisma.automationRule.count({ where: { projectId: proj.id } });
    if (existingRules >= 2) continue;

    await prisma.automationRule.create({
      data: {
        projectId: proj.id,
        name: 'Epic intake melding',
        trigger: 'issue_created',
        conditions: { type: 'EPIC' },
        actions: [{
          type: 'add_comment',
          body: 'Wijzigingsverzoek wacht op beoordeling door Erik Bakker. Neem contact op met je teamlead voor prioritering.',
        }],
        enabled: true,
      },
    });

    await prisma.automationRule.create({
      data: {
        projectId: proj.id,
        name: 'Epic goedkeuring actie',
        trigger: 'issue_updated',
        conditions: { type: 'EPIC' },
        actions: [{
          type: 'add_comment',
          body: 'Epic is goedgekeurd. Maak child stories aan voor de planningsfase.',
        }],
        enabled: true,
      },
    });
    automationCount += 2;
  }
  console.warn(`        ${automationCount} automation rules`);

  // ────────────────────────────────────────────────────────────
  // 11. Wiki spaces + pages
  // ────────────────────────────────────────────────────────────
  console.warn('  [11/12] Wiki');

  type WikiPageSeed = { slug: string; title: string; body: string };

  const wikiDefs: { teamSlug: string; name: string; slug: string; description: string; pages: WikiPageSeed[] }[] = [
    {
      teamSlug: 'team-noord',
      name: 'Team Noord Wiki',
      slug: 'team-noord-wiki',
      description: 'Documentatie voor het partnerkanaal team',
      pages: [
        {
          slug: 'ontwikkelrichtlijnen',
          title: 'Ontwikkelrichtlijnen',
          body: '# Ontwikkelrichtlijnen\n\n## Branching Strategie\n\nWij gebruiken Git Flow met de volgende branches:\n\n- `main` - Productie code\n- `develop` - Integratie branch\n- `feature/*` - Nieuwe functionaliteit\n- `hotfix/*` - Urgente fixes\n\n## Code Review\n\nElke pull request vereist minimaal 1 goedkeuring. Reviews worden binnen 24 uur afgerond.\n\n## Coding Standards\n\n- TypeScript strict mode\n- ESLint + Prettier configuratie\n- Minimaal 80% code coverage\n- Geen `any` types tenzij gedocumenteerd\n\n## Deployment\n\nDeployments gaan via de CI/CD pipeline. Alleen de `main` branch wordt naar productie gedeployed na goedkeuring.',
        },
        {
          slug: 'applicatie-overzicht',
          title: 'Applicatie-overzicht',
          body: '# Applicatie-overzicht\n\n## Partnerportaal\n\n**Technologie:** React 18, Node.js, PostgreSQL\n**Status:** Productie\n**Eigenaar:** Sanne de Boer\n\nSelf-service portaal voor partners om orders te plaatsen, rapportages te bekijken en accountgegevens te beheren.\n\n## Commissie Engine\n\n**Technologie:** Node.js, Redis, PostgreSQL\n**Status:** Productie\n**Eigenaar:** Tim Schipper\n\nBackend service voor het berekenen en uitbetalen van commissies aan partners op basis van verkoopdata.\n\n## Dealregistratie\n\n**Technologie:** React 18, Express, PostgreSQL\n**Status:** Productie\n**Eigenaar:** Mila Smit\n\nSysteem voor het registreren en opvolgen van deals in het partnerkanaal. Inclusief pipeline management en rapportage.',
        },
        {
          slug: 'release-proces',
          title: 'Release Proces',
          body: '# Release Proces\n\n## Planning\n\n1. Release candidate wordt aangemaakt op woensdag\n2. QA test donderdag en vrijdag\n3. Go/no-go beslissing vrijdag 16:00\n4. Productie deployment maandag 06:00\n\n## Checklist\n\n- Alle tests slagen\n- Code review goedgekeurd\n- Release notes geschreven\n- Stakeholders geinformeerd\n- Rollback plan klaar\n\n## Hotfix Proces\n\nBij kritieke bugs in productie:\n\n1. Hotfix branch aanmaken vanuit `main`\n2. Fix implementeren met tests\n3. Versnelde review (1 reviewer voldoende)\n4. Direct deployen naar productie\n5. Terugmergen naar `develop`',
        },
      ],
    },
    {
      teamSlug: 'team-zuid',
      name: 'Team Zuid Wiki',
      slug: 'team-zuid-wiki',
      description: 'Documentatie voor het klantkanaal team',
      pages: [
        {
          slug: 'ontwikkelrichtlijnen',
          title: 'Ontwikkelrichtlijnen',
          body: '# Ontwikkelrichtlijnen\n\n## Frontend Architectuur\n\nWij gebruiken een component-driven architectuur met:\n\n- **React 18** met Server Components waar mogelijk\n- **Tailwind CSS** voor styling\n- **TanStack Query** voor server state management\n- **Zustand** voor client state\n\n## API Conventies\n\n- RESTful endpoints met versioning (`/api/v2/...`)\n- JSON:API response format\n- Rate limiting op alle publieke endpoints\n- OAuth 2.0 authenticatie\n\n## Testing\n\n- Unit tests: Vitest\n- Integration tests: Supertest\n- E2E tests: Playwright\n- Visuele regressie: Chromatic',
        },
        {
          slug: 'applicatie-overzicht',
          title: 'Applicatie-overzicht',
          body: '# Applicatie-overzicht\n\n## Klantportaal\n\n**Technologie:** Next.js 14, TypeScript, PostgreSQL\n**Status:** Productie (migratie naar nieuwe huisstijl lopend)\n**Eigenaar:** Joris Visser\n\nPortaal voor directe klanten: bestellen, facturen inzien, support tickets aanmaken.\n\n## Offertetool\n\n**Technologie:** React 18, Express, MongoDB\n**Status:** Productie\n**Eigenaar:** Fenna Mulder\n\nTool voor het maken, configureren en versturen van offertes. Inclusief product catalogus en prijsberekening.\n\n## Orderverwerking\n\n**Technologie:** Node.js, RabbitMQ, PostgreSQL\n**Status:** Productie\n**Eigenaar:** Ruben Kok\n\nEvent-driven systeem voor het verwerken van orders. Ontvangt orders via EDI, API en handmatige invoer.',
        },
        {
          slug: 'api-standaarden',
          title: 'API Standaarden',
          body: '# API Standaarden\n\n## Naamgeving\n\n- Endpoints in kebab-case: `/api/v2/order-lines`\n- Query parameters in camelCase: `?pageSize=20&sortBy=createdAt`\n- Request/response body in camelCase\n\n## Foutafhandeling\n\nAlle errors volgen dit format:\n\n```json\n{\n  "error": {\n    "code": "VALIDATION_ERROR",\n    "message": "Beschrijving van de fout",\n    "details": []\n  }\n}\n```\n\n## Paginering\n\nCursor-based paginering voor alle lijst endpoints:\n\n```\nGET /api/v2/orders?cursor=abc123&limit=20\n```\n\n## Versioning\n\n- Major versie in URL pad (`/api/v2/`)\n- Breaking changes alleen bij major versie update\n- Minimaal 6 maanden deprecation period',
        },
      ],
    },
    {
      teamSlug: 'team-ai',
      name: 'AI Kennisbank',
      slug: 'ai-kennisbank',
      description: 'Kennisbank voor AI en machine learning ontwikkeling',
      pages: [
        {
          slug: 'ontwikkelrichtlijnen',
          title: 'Ontwikkelrichtlijnen',
          body: '# Ontwikkelrichtlijnen AI Team\n\n## Model Development\n\n- Gebruik MLflow voor experiment tracking\n- Alle modellen geregistreerd in het model registry\n- Minimaal 3 evaluatiemetrieken per model\n- A/B testing verplicht voor productie updates\n\n## Data Management\n\n- Persoonlijke gegevens altijd pseudonimiseren\n- Data versioning via DVC (Data Version Control)\n- Training data opgeslagen in Azure Blob Storage\n- Geen productie data in development omgevingen\n\n## Code Kwaliteit\n\n- Python: Black + Ruff formatter\n- Type hints verplicht (mypy strict mode)\n- Docstrings voor alle publieke functies\n- Jupyter notebooks alleen voor exploratie, niet voor productie code',
        },
        {
          slug: 'model-documentatie',
          title: 'Model Documentatie',
          body: '# Model Documentatie\n\n## AI Assistent - GPT-4 Turbo\n\n**Versie:** 1.2.0\n**Laatst bijgewerkt:** 2026-03-15\n**Verantwoordelijke:** Anika Bos\n\n### Configuratie\n- Temperature: 0.3\n- Max tokens: 4096\n- System prompt: zie `/config/system-prompts/assistant-v1.2.md`\n\n### Kosten\n- Gemiddeld 0.02 EUR per gesprek\n- Maandelijks budget: 500 EUR\n\n## Documentherkenning - Azure Document Intelligence\n\n**Versie:** 3.1\n**Laatst bijgewerkt:** 2026-04-01\n**Verantwoordelijke:** Thijs Meijer\n\n### Nauwkeurigheid\n- Getypte tekst: 98.5%\n- Handgeschreven tekst: 82.3% (verbetering lopend)\n- Tabellen: 95.1%\n\n### Ondersteunde formaten\nPDF, JPEG, PNG, TIFF, BMP',
        },
        {
          slug: 'data-pipeline-architectuur',
          title: 'Data Pipeline Architectuur',
          body: '# Data Pipeline Architectuur\n\n## Overzicht\n\nDe data pipeline verwerkt documenten van ontvangst tot gestructureerde data:\n\n```\nDocument Upload -> Preprocessing -> OCR/HTR -> Post-processing -> Validatie -> Opslag\n```\n\n## Componenten\n\n### 1. Document Preprocessing\n- Beeldkwaliteit verbeteren (deskew, contrast)\n- Pagina segmentatie\n- Taaldetectie\n\n### 2. OCR/HTR Engine\n- Azure Document Intelligence voor getypte tekst\n- Custom HTR model voor handgeschreven tekst\n- Confidence scoring per veld\n\n### 3. Post-processing\n- Named Entity Recognition (NER)\n- Bedrag en datum normalisatie\n- Adres validatie via PostNL API\n\n### 4. Validatie\n- Business rules engine\n- Handmatige controle bij lage confidence\n- Feedback loop naar model training\n\n## Infrastructuur\n\n- **Compute:** Azure Kubernetes Service\n- **Queue:** Azure Service Bus\n- **Storage:** Azure Blob Storage + PostgreSQL\n- **Monitoring:** Grafana + Prometheus',
        },
      ],
    },
  ];

  let totalPages = 0;
  for (const wd of wikiDefs) {
    const space = await prisma.wikiSpace.upsert({
      where: { teamId_slug: { teamId: teams[wd.teamSlug].id, slug: wd.slug } },
      update: {},
      create: {
        teamId: teams[wd.teamSlug].id,
        name: wd.name,
        slug: wd.slug,
        description: wd.description,
      },
    });

    // Space permissions
    const existingPerm = await prisma.spacePermission.findFirst({ where: { spaceId: space.id } });
    if (!existingPerm) {
      await prisma.spacePermission.create({ data: { spaceId: space.id, teamRole: 'ADMIN', level: 'ADMIN' } });
      await prisma.spacePermission.create({ data: { spaceId: space.id, teamRole: 'MEMBER', level: 'EDIT' } });
    }

    for (let i = 0; i < wd.pages.length; i++) {
      const pg = wd.pages[i];
      const existingPage = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: space.id, slug: pg.slug } },
      });

      if (existingPage) {
        totalPages++;
        continue;
      }

      const page = await prisma.page.create({
        data: {
          spaceId: space.id,
          title: pg.title,
          slug: pg.slug,
          body: pg.body,
          position: i + 1,
        },
      });

      await prisma.pageVersion.create({
        data: {
          pageId: page.id,
          title: pg.title,
          body: pg.body,
          version: 1,
          authorId: users.erik.id,
        },
      });
      totalPages++;
    }
    console.warn(`        ${wd.name} (${wd.pages.length} pages)`);
  }

  // ────────────────────────────────────────────────────────────
  // 12. Comments on key issues
  // ────────────────────────────────────────────────────────────
  console.warn('  [12/12] Comments');

  const commentDefs = [
    {
      issueTitle: 'SAML-authenticatie provider implementeren',
      projectSlug: 'partnerportaal',
      comments: [
        { author: 'sanne', body: 'Microsoft Entra ID SAML metadata URL geconfigureerd. Eerste test met dev-tenant is gelukt. Nu assertion mapping opzetten voor de juiste claims (naam, email, groepen).' },
        { author: 'tim', body: 'Let op dat we de group claims nodig hebben voor role-based access. Documentatie: https://learn.microsoft.com/en-us/entra/identity/saml' },
      ],
    },
    {
      issueTitle: 'Batch verwerking van orders',
      projectSlug: 'orderverwerking',
      comments: [
        { author: 'ruben', body: 'Eerste benchmarks: batch size van 100 orders geeft 8x speedup. Bij 500 orders neemt de database load te veel toe. Optimale batch size lijkt 200.' },
        { author: 'erik', body: 'Goed werk. Kunnen we de batch size configureerbaar maken zodat we dit per omgeving kunnen tunen?' },
      ],
    },
    {
      issueTitle: 'Document ingestion pipeline opzetten',
      projectSlug: 'ai-assistent',
      comments: [
        { author: 'anika', body: 'LangChain TextSplitter geconfigureerd met chunk_size=1000 en overlap=200. Confluence API connector werkt, SharePoint connector nog in development.' },
        { author: 'thijs', body: 'Voor de SharePoint connector: gebruik de Microsoft Graph API met app-only permissions. Ik heb al een registratie in de dev-tenant.' },
      ],
    },
    {
      issueTitle: 'Prijsberekening fout bij staffelkortingen',
      projectSlug: 'offertetool',
      comments: [
        { author: 'fenna', body: 'Root cause gevonden: de korting werd per schijf berekend EN ook nog eens over het totaal. Fix is om de schijfberekening exclusief te maken. Unit tests toegevoegd voor alle combinaties.' },
      ],
    },
  ];

  let totalComments = 0;
  for (const cs of commentDefs) {
    const projectId = projects[cs.projectSlug].id;
    const issue = await prisma.issue.findFirst({ where: { projectId, title: cs.issueTitle } });
    if (!issue) continue;

    const existingCount = await prisma.comment.count({ where: { issueId: issue.id } });
    if (existingCount >= cs.comments.length) continue;

    for (const c of cs.comments.slice(existingCount)) {
      await prisma.comment.create({
        data: {
          issueId: issue.id,
          authorId: users[c.author].id,
          body: c.body,
        },
      });
      totalComments++;
    }
  }
  console.warn(`        ${totalComments} comments`);

  console.warn('\nVoorbeeld demo seed complete!');
  console.warn('Login at http://localhost:7000/login');
  console.warn('Credentials: erik / password123 (manager) | tim / password123 (dev + admin)\n');
}

main()
  .catch((e) => {
    console.error('Voorbeeld seed failed:', e);
    process.exit(1);
  })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
