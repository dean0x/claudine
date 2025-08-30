# Effect + TypeScript Project Guidelines

## 1. Project Setup

Start with these TypeScript settings from day 1:

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

## 2. Type Definition Guidelines

### Avoid:
```typescript
interface Config {
  timeout?: number;  // Can be omitted
}
```

### Prefer:
```typescript
interface Config {
  timeout: number | undefined;  // Must be explicitly set
}
```

## 3. Effect Service Pattern

Always follow this pattern for services:

```typescript
export interface MyService {
  readonly doSomething: () => Effect.Effect<void, Error, never>
}

export const MyService = Context.Tag<MyService>()

export const MyServiceLive = Layer.effect(
  MyService,
  Effect.succeed({ doSomething: () => Effect.void })
)
```

## 4. Error Handling

Always use proper error types:

```typescript
class MyError extends Data.TaggedError<MyError>("MyError")<{
  readonly message: string
}> {}
```

Not strings or unknown.

## 5. SQL Client Usage

Use the correct SQL client API:

```typescript
yield* sql`SELECT * FROM users`  // Template literal
```

Not: `sql.withoutTransforms(query)`

## 6. Development Workflow

- Run `tsc --noEmit` frequently during development
- Fix type errors immediately, don't let them accumulate
- Use `--incremental` for faster type checking
- Set up pre-commit hooks to catch type errors

## 7. Code Review Checklist

- [ ] All optional properties have explicit undefined handling
- [ ] Service dependencies use proper Layer composition
- [ ] Error types are properly defined (not string/unknown)
- [ ] No type assertions without justification