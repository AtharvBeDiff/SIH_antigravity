# MPLADS Insight & Integrity Platform — Data Contract

## 1. 21-Column e-SAKSHI Ingest Specification

| # | Column Name | Database Field | Type | Null Allowed | Description |
|---|---|---|---|---|---|
| 1 | `work_id` | `works.esakshi_work_id` | TEXT | NO | Unique work identifier |
| 2 | `district_lgd` | `districts.lgd_code` | TEXT | NO | District LGD Code |
| 3 | `constituency_code` | `constituencies.lgd_code` | TEXT | NO | Constituency identifier |
| 4 | `work_title` | `works.title` | TEXT | NO | Project title |
| 5 | `work_description` | `works.description` | TEXT | YES | Detailed scope of work |
| 6 | `category` | `works.category` | TEXT | NO | Sector (ROADS, WATER, etc.) |
| 7 | `sanctioned_amount` | `works.sanctioned_amount` | NUMBER | NO | Sanctioned rupees |
| 8 | `released_amount` | `works.released_amount` | NUMBER | YES | Disbursed funds |
| 9 | `expenditure` | `works.expenditure` | NUMBER | YES | Documented expenditure |
| 10 | `sanction_date` | `works.sanction_date` | DATE | NO | Sanction date (YYYY-MM-DD) |
| 11 | `completion_date` | `works.actual_completion_date` | DATE | YES | Actual completion date |
| 12 | `status` | `works.status` | TEXT | NO | NOT_STARTED, IN_PROGRESS, COMPLETED, ON_HOLD, CANCELLED |
| 13 | `physical_progress_pct` | `works.physical_progress_pct` | NUMBER | YES | 0 - 100 percentage |
| 14 | `has_uc` | `works.has_uc` | BOOLEAN | YES | Utilisation Certificate filed |
| 15 | `agency_name` | `agencies.name` | TEXT | YES | Implementing Agency name |
| 16 | `latitude` | `works.latitude` | NUMBER | YES | Asset GPS latitude |
| 17 | `longitude` | `works.longitude` | NUMBER | YES | Asset GPS longitude |
| 18 | `is_scsp` | `works.is_scsp` | BOOLEAN | YES | SC Sub-Plan (15% mandate) |
| 19 | `is_tsp` | `works.is_tsp` | BOOLEAN | YES | Tribal Sub-Plan (7.5% mandate) |
| 20 | `first_installment` | `works.first_installment` | NUMBER | YES | Initial advance release |
| 21 | `second_installment` | `works.second_installment` | NUMBER | YES | Milestone installment |

---

## 2. National Calibration Benchmarks

- **MoSPI Published Delivery Rate**: 19.24% by value across financial cycles.
- **Statutory SC Reservation Mandate**: Minimum 15.0% of recommended works value.
- **Statutory ST Reservation Mandate**: Minimum 7.5% of recommended works value.
- **Physical Inspection Target**: Minimum 50.0% of completed infrastructure assets.
