# Trial Balance Report API Examples

## 1. Get Trial Balance As Of Date
Gets cumulative balance for all accounts up to the specified date.
Defaults to end of day.

```bash
curl "http://localhost:5000/api/v1/reports/trial-balance?asOf=2026-01-31" \
  -H "Authorization: Bearer <token>"
```

## 2. Get Trial Balance for Date Range
Gets net movement for accounts between two dates.
(Note: This shows activity, not necessarily ending balance unless start date is beginning of time)

```bash
curl "http://localhost:5000/api/v1/reports/trial-balance?from=2026-01-01&to=2026-01-31" \
  -H "Authorization: Bearer <token>"
```

## 3. Get Trial Balance for Fiscal Period
Gets report for a specific fiscal period ID.

```bash
# First get period ID from fiscal calendar
# Then use it here:
curl "http://localhost:5000/api/v1/reports/trial-balance?fiscalPeriodId=65a1234567890abcdef12345" \
  -H "Authorization: Bearer <token>"
```

## 4. Include Zero Balance Accounts
By default, only accounts with activity/balance are shown. Use includeZero=true to see all.

```bash
curl "http://localhost:5000/api/v1/reports/trial-balance?asOf=2026-01-31&includeZero=true" \
  -H "Authorization: Bearer <token>"
```

## 5. Include Non-Posting Accounts
By default, only posting accounts are shown. Use includeNonPosting=true to see headers.

```bash
curl "http://localhost:5000/api/v1/reports/trial-balance?asOf=2026-01-31&includeNonPosting=true" \
  -H "Authorization: Bearer <token>"
```
