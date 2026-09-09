import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  // Length + a basic complexity check happens here; the real strength
  // guarantee comes from argon2id hashing, not from client-side rules.
  @IsString()
  @Length(10, 72) // argon2/bcrypt-family inputs are conventionally capped
  @Matches(/[0-9]/, { message: 'password must contain at least one number' })
  password!: string;

  @IsString()
  @Length(1, 60)
  firstName!: string;
}
