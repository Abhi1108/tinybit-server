'use strict';

// Regression guard for the timezone-architecture fix (see docs/timezone-architecture-plan.md
// in the sibling `tinybit` repo). New code has already bypassed the shared date utilities once
// (`defaultDayBounds()` in medicine-logs.mysql.js used raw `setUTCHours` instead of the
// timezone-aware helpers) — this is what actually keeps that fix from silently rotting.
//
// Scoped narrowly to "computing 'today' from the current moment via raw UTC truncation of
// `new Date()`" — NOT to every `.toISOString()`/`.slice()` call. Converting an already-fetched
// MySQL DATE column value to a string (e.g. the various `columnDateOnly`-style helpers) is a
// different, legitimate operation and must not be forced through this rule.

const TODAY_VIA_UTC_TRUNCATION_MSG =
  'Don\'t compute "today" via new Date().toISOString() truncation — this ignores the user\'s ' +
  'timezone and reintroduces the historical UTC-truncation bug. Use resolveTodayForUser()/' +
  'getUserTimezone() (services/timezone.service.js) or todayForTimezone()/dateOnlyForTimezone() ' +
  '(utils/date.js) instead.';

const DEFAULT_PARAM_NEW_DATE_MSG =
  'Don\'t use a bare `new Date()` as a function\'s default parameter value in services/' +
  'controllers — it silently resolves to the server\'s own clock at call time, not any ' +
  'particular user\'s. Resolve the value explicitly inside the function body instead (e.g. via ' +
  'resolveTodayForUser()).';

const NEW_DATE_NO_ARGS =
  "[callee.object.callee.object.type='NewExpression'][callee.object.callee.object.callee.name='Date'][callee.object.callee.object.arguments.length=0]";

module.exports = [
  {
    files: ['src/services/**/*.js', 'src/controllers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']${NEW_DATE_NO_ARGS}`,
          message: TODAY_VIA_UTC_TRUNCATION_MSG,
        },
        {
          selector: `CallExpression[callee.property.name='slice'][arguments.0.value=0][arguments.1.value=10][callee.object.callee.property.name='toISOString']${NEW_DATE_NO_ARGS}`,
          message: TODAY_VIA_UTC_TRUNCATION_MSG,
        },
        {
          selector: "AssignmentPattern > NewExpression[callee.name='Date'][arguments.length=0]",
          message: DEFAULT_PARAM_NEW_DATE_MSG,
        },
      ],
    },
  },
];
