/**
 * Perform the direct upload of a single file.
 *
 * @providesModule Upload
 * @flow
 */

import * as ActiveStorage from 'activestorage'
import { buildUrl, compactObject } from './helpers'

import type { ActiveStorageFileUpload, Origin, CustomHeaders } from './types'

type Options = {|
  origin?: Origin,
  directUploadsPath?: string,
  onBeforeBlobRequest?: ({
    id: string,
    file: File,
    xhr: XMLHttpRequest,
  }) => mixed,
  onBeforeStorageRequest?: ({
    id: string,
    file: File,
    xhr: XMLHttpRequest,
  }) => mixed,
  onChangeFile: ({ [string]: ActiveStorageFileUpload }) => mixed,
  headers?: CustomHeaders,
|}

class Upload {
  static CONVENTIONAL_DIRECT_UPLOADS_PATH =
    '/rails/active_storage/direct_uploads'

  static defaultOptions = {
    origin: {},
    directUploadsPath: Upload.CONVENTIONAL_DIRECT_UPLOADS_PATH,
  }

  directUpload: ActiveStorage.DirectUpload
  options: { ...Options, ...typeof Upload.defaultOptions }

  constructor(file: File, options: Options) {
    this.options = { ...Upload.defaultOptions, ...compactObject(options) }
    this.directUpload = new ActiveStorage.DirectUpload(
      file,
      this.directUploadsUrl,
      this
    )

    this.handleChangeFile({ state: 'waiting', id: this.id, file })
  }

  get id(): string {
    return `${this.directUpload.id}`
  }

  get directUploadsUrl(): string {
    const { origin, directUploadsPath } = this.options

    return buildUrl({ ...origin, path: directUploadsPath })
  }

  handleChangeFile = (upload: ActiveStorageFileUpload) => {
    this.options.onChangeFile({ [this.id]: upload })
  }

  handleProgress = ({ loaded, total }: ProgressEvent) => {
    const progress = (loaded / total) * 100

    this.handleChangeFile({
      state: 'uploading',
      file: this.directUpload.file,
      id: this.id,
      progress,
    })
  }

  handleSuccess = (signedId: string) => {
    this.handleChangeFile({
      state: 'finished',
      id: this.id,
      file: this.directUpload.file,
    })
    return signedId
  }

  handleError = (error: string) => {
    this.handleChangeFile({
      state: 'error',
      id: this.id,
      file: this.directUpload.file,
      error,
    })
    return error // Not Throwing, because we can allow some of the files to upload.
  }

  start(): Promise<string> {
    const promise = new Promise((resolve, reject) => this.upload(resolve, reject))
    return promise.then(this.handleSuccess).catch(this.handleError)
  }

  upload(resolve, reject): void {
    this.directUpload.create((error, attributes) => {
      if (error) {
        error = error.replace('creating Blob for', 'uploading')
        if (error.includes('Status: 413')) {
          // File would exceed Storage Size
          let _error = error.replace('Status: 413', `This file's size (${Math.round(this.directUpload.file.size / (1024 * 1024))}MB) would exceed your account's storage quota.`)
          reject(new Error(_error));
        } else if (error.includes('Status: 423')) {
          // Advisory Lock blocked this call, we need to try again
          setTimeout(() => { this.upload(resolve, reject) }, 500 + Math.floor(Math.random() * 1501));
        } else {
          reject(new Error(error));
        }
      } else {
        resolve(attributes.signed_id)
      }
    })
  }

  /**
   * DirectUpload delegate protocol conformance
   */

  directUploadWillCreateBlobWithXHR(xhr: XMLHttpRequest) {
    this.addHeaders(xhr)

    this.options.onBeforeBlobRequest &&
      this.options.onBeforeBlobRequest({
        id: this.id,
        file: this.directUpload.file,
        xhr,
      })
  }

  directUploadWillStoreFileWithXHR(xhr: XMLHttpRequest) {
    this.options.onBeforeStorageRequest &&
      this.options.onBeforeStorageRequest({
        id: this.id,
        file: this.directUpload.file,
        xhr,
      })

    xhr.upload.addEventListener('progress', this.handleProgress)
  }

  /**
   * @private
   */

  addHeaders(xhr: XMLHttpRequest) {
    const headers = this.options.headers
    if (headers) {
      for (const headerKey of Object.keys(headers)) {
        xhr.setRequestHeader(headerKey, headers[headerKey])
      }
    }
  }
}

export default Upload
