import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MAX_BYTES = 72;
// `u` makes `.` match a whole code point (emoji count once), `s` lets it match newlines
const MIN_LENGTH = /^.{8,}$/su;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

function policyViolation(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'password must be a string';
  }
  if (!MIN_LENGTH.test(value)) {
    return 'password must be at least 8 characters long';
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) {
    return `password must be at most ${MAX_BYTES} bytes long`;
  }
  if (!LETTER.test(value) || !DIGIT.test(value)) {
    return 'password must contain at least one letter and one digit';
  }
  return null;
}

@ValidatorConstraint({ name: 'isPasswordPolicy' })
export class PasswordPolicyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return policyViolation(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return policyViolation(args.value) ?? 'password is invalid';
  }
}

export function IsPasswordPolicy(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: PasswordPolicyConstraint,
    });
  };
}
