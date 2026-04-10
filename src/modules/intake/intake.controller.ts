import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';

import * as intakeService from './intake.service';
import {
  listSubmissionsSchema,
  reviewSubmissionSchema,
  approveSubmissionSchema,
} from './intake.validation';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = validate(listSubmissionsSchema, req.query);
  const result = await intakeService.listSubmissions(param(req, 'projectId'), query);
  res.json(result);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const submission = await intakeService.getSubmission(
    param(req, 'submissionId'),
    param(req, 'projectId'),
  );
  res.json(submission);
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(approveSubmissionSchema, req.body);
  const submission = await intakeService.approveSubmission(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
    data,
  );
  res.json(submission);
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(reviewSubmissionSchema, req.body);
  const submission = await intakeService.rejectSubmission(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
    data.reviewNote,
  );
  res.json(submission);
});

export const markSpam = asyncHandler(async (req: Request, res: Response) => {
  const submission = await intakeService.markSpam(
    param(req, 'submissionId'),
    param(req, 'projectId'),
    req.userId!,
  );
  res.json(submission);
});
