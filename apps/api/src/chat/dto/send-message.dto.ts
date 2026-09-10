import { IsString, Length } from 'class-validator';

export class SendMessageDto {
  // Matches Message.body's VarChar(2000) column limit exactly — see
  // prisma/schema.prisma.
  @IsString()
  @Length(1, 2000)
  body!: string;
}
