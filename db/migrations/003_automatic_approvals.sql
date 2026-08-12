alter table approvals drop constraint if exists approvals_decision_check;
alter table approvals add constraint approvals_decision_check
  check (decision in ('approved', 'auto_approved'));
