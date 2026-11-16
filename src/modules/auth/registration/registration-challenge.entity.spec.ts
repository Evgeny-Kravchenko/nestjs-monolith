import { getMetadataArgsStorage } from 'typeorm';

import { User } from '@/modules/users/user.entity';

import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationMethod } from './registration-method.enum';

describe('RegistrationChallenge entity', () => {
  const storage = getMetadataArgsStorage();

  const column = (propertyName: string) => {
    const found = storage
      .filterColumns(RegistrationChallenge)
      .find((c) => c.propertyName === propertyName);
    if (!found) {
      throw new Error(`Column for property ${propertyName} not found`);
    }
    return found;
  };

  const index = (name: string) =>
    storage.filterIndices(RegistrationChallenge).find((i) => i.name === name);

  it('should map to the registration_challenges table', () => {
    const table = storage.tables.find(
      (t) => t.target === RegistrationChallenge,
    );

    expect(table?.name).toBe('registration_challenges');
  });

  it('should use an application-generated uuid primary key', () => {
    const generation = storage.generations.find(
      (g) => g.target === RegistrationChallenge && g.propertyName === 'id',
    );

    expect(column('id').options).toMatchObject({ primary: true, type: 'uuid' });
    expect(generation).toBeUndefined();
  });

  it('should reference users through user_id with ON DELETE CASCADE', () => {
    const relation = storage
      .filterRelations(RegistrationChallenge)
      .find((r) => r.propertyName === 'user');
    const joinColumn = storage
      .filterJoinColumns(RegistrationChallenge, 'user')
      .at(0);

    expect(column('userId').options).toMatchObject({
      name: 'user_id',
      type: 'uuid',
    });
    expect(relation?.relationType).toBe('many-to-one');
    expect((relation?.type as () => unknown)()).toBe(User);
    expect(relation?.options.onDelete).toBe('CASCADE');
    expect(joinColumn?.name).toBe('user_id');
  });

  it('should allow only one challenge per user', () => {
    const userIndex = index('UQ_registration_challenges_user_id');

    expect(userIndex?.unique).toBe(true);
    expect(userIndex?.columns).toEqual(['userId']);
  });

  it('should index secret_hash uniquely for magic links only', () => {
    const secretIndex = index('UQ_registration_challenges_magic_link_secret');

    expect(secretIndex?.unique).toBe(true);
    expect(secretIndex?.columns).toEqual(['secretHash']);
    expect(secretIndex?.where).toBe("method = 'magic_link'");
  });

  it('should store method as the registration_challenges_method_enum enum', () => {
    expect(column('method').options).toMatchObject({
      type: 'enum',
      enum: RegistrationMethod,
      enumName: 'registration_challenges_method_enum',
    });
  });

  it('should store the secret digest as char(64)', () => {
    expect(column('secretHash').options).toMatchObject({
      name: 'secret_hash',
      type: 'char',
      length: 64,
    });
  });

  it('should keep expires_at required and last_sent_at, consumed_at nullable', () => {
    expect(column('expiresAt').options).toMatchObject({
      name: 'expires_at',
      type: 'timestamptz',
    });
    expect(column('expiresAt').options.nullable).toBeFalsy();
    expect(column('lastSentAt').options).toMatchObject({
      name: 'last_sent_at',
      type: 'timestamptz',
      nullable: true,
    });
    expect(column('consumedAt').options).toMatchObject({
      name: 'consumed_at',
      type: 'timestamptz',
      nullable: true,
    });
  });

  it('should count wrong entries in a smallint between 0 and 5', () => {
    const check = storage.checks.find(
      (c) =>
        c.target === RegistrationChallenge &&
        c.name === 'CHK_registration_challenges_attempts',
    );

    expect(column('attempts').options).toMatchObject({
      type: 'smallint',
      default: 0,
    });
    expect(check?.expression).toBe('attempts BETWEEN 0 AND 5');
  });

  it('should keep created_at and updated_at as timestamptz', () => {
    expect(column('createdAt').mode).toBe('createDate');
    expect(column('createdAt').options).toMatchObject({
      name: 'created_at',
      type: 'timestamptz',
    });
    expect(column('updatedAt').mode).toBe('updateDate');
    expect(column('updatedAt').options).toMatchObject({
      name: 'updated_at',
      type: 'timestamptz',
    });
  });
});
