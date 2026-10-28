import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';
import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { GqlAuthGuard } from '../auth/gql-auth.guard.js';
import { appConfig } from '../common/config.js';
import { DocumentsService } from '../documents/documents.service.js';
import {
  DocumentUploadResult,
  UploadLimits,
} from '../documents/dto/document-upload-result.type.js';
import { UploadDocumentsInput } from '../documents/dto/upload-documents.input.js';
import { ALLOWED_EXTENSIONS } from '../documents/file-validation.js';

@Resolver()
export class UploadResolver {
  constructor(private readonly documents: DocumentsService) {}

  /** Permite al frontend validar antes de enviar con los mismos límites del backend. */
  @Query(() => UploadLimits)
  uploadLimits(): UploadLimits {
    const { maxUploadBytes, maxFilesPerUpload } = appConfig();
    return {
      maxFileBytes: maxUploadBytes,
      maxFiles: maxFilesPerUpload,
      allowedExtensions: ALLOWED_EXTENSIONS,
    };
  }

  @Mutation(() => [DocumentUploadResult])
  @UseGuards(GqlAuthGuard)
  uploadDocuments(
    @Args({ name: 'files', type: () => [GraphQLUpload] })
    files: Promise<FileUpload>[],
    @Args('input') input: UploadDocumentsInput,
  ): Promise<DocumentUploadResult[]> {
    return this.documents.upload(files, input.documents);
  }
}
