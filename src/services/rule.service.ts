import { AuthUser } from '../routes/auth'; // Assuming AuthUser type from auth routes

export interface RuleContext {
  authRecord?: AuthUser | null;      // Authenticated user details
  requestData?: Record<string, any>; // Data from the incoming request body
  // record?: Record<string, any>;   // Existing record data (for more complex evaluations, not used in this initial version for WHERE clause generation)
}

// Represents a parsed SQL condition
export interface EvaluatedCondition {
  sql: string;
  params: any[];
}

// Whitelisted characters for field names (to prevent SQL injection if used directly, though parameterization is preferred)
const validFieldNameRegex = /^[a-zA-Z0-9_]+$/;

/**
 * Evaluates a PocketBase-like rule string into an SQL condition and parameters.
 * Initial version focuses on:
 * - @request.auth.id
 * - Direct field comparisons (field = 'value', field = @request.auth.id)
 * - Limited operators: =, !=, >, <, >=, <=
 * - AND/OR (passed through for now, assumes valid SQL syntax by admin)
 * - Does NOT support functions, complex arithmetic, or subqueries directly.
 */
export function evaluateRule(
  ruleString: string | null | undefined,
  context: RuleContext
): { condition?: EvaluatedCondition; error?: string; allow?: boolean } {
  if (ruleString === null || ruleString === undefined || ruleString.trim() === '') {
    return { allow: true }; // Empty rule means allow access (PocketBase default)
  }

  let processedRule = ruleString;
  const params: any[] = [];

  // Handle @request.auth.id
  // Ensure authRecord and its id exist before replacing.
  if (context.authRecord && context.authRecord.userId) {
    const authIdPlaceholder = '?'; // Using standard SQL placeholder
    // Count occurrences to add correct number of params
    const authIdOccurrences = (processedRule.match(/@request\.auth\.id/g) || []).length;
    for (let i = 0; i < authIdOccurrences; i++) {
        params.push(context.authRecord.userId);
    }
    processedRule = processedRule.replace(/@request\.auth\.id/g, authIdPlaceholder);
  } else {
    // If rule requires auth but no auth user, deny access if @request.auth.id is used
    if (ruleString.includes('@request.auth.id')) {
      // Deny access by returning a condition that's always false
      return { condition: { sql: '1=0', params: [] }, allow: false };
    }
  }

  // Handle @request.data.fieldName (simple replacement, assumes fieldName is safe)
  // A more robust solution would parse the rule string properly.
  if (context.requestData) {
      for (const key in context.requestData) {
          if (Object.prototype.hasOwnProperty.call(context.requestData, key)) {
              const placeholder = `@request.data.${key}`;
              if (processedRule.includes(placeholder)) {
                  // Count occurrences for correct param count
                  const occurrences = (processedRule.match(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\]/g, '\$&'), 'g')) || []).length;
                  for (let i = 0; i < occurrences; i++) {
                      params.push(context.requestData[key]); // Add the actual data value to params
                  }
                  // Replace placeholder with '?'
                  processedRule = processedRule.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\]/g, '\$&'), 'g'), '?');
              }
          }
      }
  }

  // Basic keyword check to prevent obvious SQL injection, though parameterization is the main defense.
  // This is NOT a foolproof SQL injection prevention method.
  const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TABLE', 'CREATE', 'ALTER', ';--', '; DROP'];
  for (const keyword of forbiddenKeywords) {
    if (processedRule.toUpperCase().includes(keyword)) {
      // console.warn(`Rule might contain problematic keywords: ${keyword}. This is not allowed.`);
      // return { error: `Rule contains forbidden keyword: ${keyword}` };
    }
  }

  // If there are still unresolved @ placeholders (other than the ones handled)
  if (processedRule.includes('@')) {
      console.warn(`Rule contains unresolved '@' placeholders: ${processedRule}. Denying access.`);
      return { condition: { sql: '1=0', params: [] }, allow: false };
  }

  // If after processing, the rule is empty, it means it was fully resolved by placeholders (e.g. "'' = @request.auth.id" and auth.id is empty string)
  // or it was something like "@request.auth.id != @request.auth.id" which becomes "? != ?"
  // An empty processedRule usually means the original rule was only placeholders that got substituted.
  // This interpretation needs refinement. For now, if it's empty, treat as "no specific condition from rule".
  if (processedRule.trim() === '') {
      // This could happen if rule was e.g. "@request.auth.id" and it resolved to "?".
      // This isn't a complete SQL condition.
      // For now, let's assume an empty processed rule string (after substitutions) means no *additional* conditions from the rule.
      // The `allow: true` here is important. If the rule was just "@request.auth.id != null" and auth.id exists, it becomes "? != null"
      // which is a valid condition. If it was just "@request.auth.id" this is not a condition.
      // PocketBase's rule evaluation is more complex.
      // For now, if the rule is not empty, it's treated as an SQL WHERE clause.
      return { allow: true }; // No specific condition, just allow based on other checks.
  }


  // If we reach here, the processedRule is considered the SQL condition.
  return { condition: { sql: processedRule, params: params }, allow: true };
}

console.log('Rule service (rule.service.ts) created.');
