import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsOptional, IsUUID } from 'class-validator';

export class EventsQueryDto {
  /** `?ids=a,b,c`: documentos a seguir. Sin ids se reciben los cambios de todos. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))] : value,
  )
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  ids: string[] = [];
}
