export const meetingNotes = {
  name: 'Meeting Notes',
  description: 'Capture attendees, agenda, discussion notes, and action items',
  body: `## Date
{{now()}}

## Facilitator
{{currentUser.displayName}}

## Team
{{team.name}}

## Attendees
- @

## Agenda
1.

## Discussion Notes

## Action Items
- [Owner] - [Task] - [Due Date]

## Decisions Made
`,
};
