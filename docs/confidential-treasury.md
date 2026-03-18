
# Confidential Treasury

## References

Pull Request to analyze from near.com frontend:
https://github.com/defuse-protocol/defuse-frontend/pull/962

## Peter's Tasks

### 1.1 Proof of concept confidential balances and transfer
- Learn from near.com implementation how to create the access token, where is the API server (URL)

### 1.2 Create a small script in Rust to get confidential balance, and list of transactions

### 1.3 Create a small script in Rust to request confidential quote → deposit there (e.g. with near-cli-rs) → observe the new balance

### 1.4 Create a small script in Rust to transfer within FAR network

### 1.5 Create a small script in Rust to withdraw to public chains

## Megha's Tasks

### 1.4 Limit features for confidential treasuries
- We don't support bulk payments, export on the UI - mark them as "coming soon"
- Depends on: 1.4.1 Add a flag to the backend (confidential or not)

### 1.4.1 Add a flag to the backend (confidential or not)

### 1.5 Extend the onboarding with confidential treasury option

## Backend Tasks (unassigned)

### 1.2 Backend for getting the balances, keep track of confidential transactions
- Or references that we can re-populate the database from

### 1.3 Backend for processing the approved proposals
- Construct a signed FAR chain request from the v1.signer signature

